/**
 * The generation pipeline: resolve translations for a language, clone the
 * frames, write the text, fit what overflowed, repeat.
 *
 * It reaches for nothing global. The document, storage, cancellation and the
 * provider round-trip all arrive as parameters, and the result is returned
 * rather than posted — which is what makes the whole thing runnable in a test
 * against a fake document.
 */

import type { CancellationToken } from '../shared/cancellation';
import { LANGUAGES, langByCode, localizedName } from '../shared/languages';
import { swallow } from '../shared/log';
import type { GenerateConfig, GenerateSummary, LanguageDef, SourceString } from '../shared/types';
import { delay, errorText } from '../shared/util';
import { NONE, type Warning } from '../shared/warnings';
import type { DocumentPort } from './figma-port';
import {
  computeBudgets,
  localizeFrame,
  runFitPass,
  type LocalizeContext,
  type RequestTranslations,
} from './localize';
import {
  GROUP_GAP,
  CONTAINER_PADDING,
  absBox,
  createContainer,
  firstColumnX,
  indexExistingByName,
  unionBounds,
  type Container,
} from './layout';
import { scanSelection } from './selection';
import type { Storage } from './storage';
import * as TE from './text-engine';

/**
 * How many languages are resolved ahead of the cloning loop.
 *
 * 1 meant every language's round-trip was fully serialised behind the previous
 * language being drawn. Raising it trades a little more concurrent API load for
 * a materially shorter 21-language run; the provider's own `concurrency`
 * multiplies with it, so both are kept deliberately small.
 */
export const PREFETCH_LANGUAGES = 2;

export interface ProgressUpdate {
  label: string;
  langIndex: number;
  langTotal: number;
  frameIndex: number;
  frameTotal: number;
}

export interface PipelineDeps {
  doc: DocumentPort;
  storage: Storage;
  token: CancellationToken;
  request: RequestTranslations;
  onProgress: (update: ProgressUpdate) => void;
}

export type GenerateOutcome =
  | { status: 'error'; message: string }
  | { status: 'cancelled'; framesCreated: number; warnings: Warning[] }
  | { status: 'done'; summary: GenerateSummary; warnings: Warning[] };

interface Resolved {
  byId: Record<string, string>;
  cacheHits: number;
  /** Set only when nothing usable came back at all — the language is skipped. */
  fatal?: string;
  notes: Warning[];
}

/**
 * Everything a language needs before its frames can be written: translation
 * memory first, one provider round-trip for the rest.
 *
 * Kept separate from the cloning loop so the next language's network call can
 * be started while the current one is still being drawn into the document.
 */
async function resolveLanguage(
  lang: LanguageDef,
  sourceLang: LanguageDef,
  allStrings: SourceString[],
  config: GenerateConfig,
  deps: PipelineDeps,
  budgets: Record<string, number> | undefined,
  quiet: boolean
): Promise<Resolved> {
  const notes: Warning[] = [];
  const note = (detail: Warning['detail'], severity: Warning['severity']) => {
    notes.push({ frame: NONE, language: lang.code, layer: NONE, detail, severity });
  };

  const byId: Record<string, string> = {};
  if (lang.code === sourceLang.code) {
    for (const item of allStrings) byId[item.id] = item.text;
    return { byId, cacheHits: 0, notes };
  }

  const memory = await deps.storage.loadTM(config.cacheKey, sourceLang.tag, lang.tag);
  const missing: SourceString[] = [];
  let cacheHits = 0;

  for (const item of allStrings) {
    const hit = memory[item.text];
    if (typeof hit === 'string' && hit.length) {
      byId[item.id] = hit;
      cacheHits++;
    } else {
      missing.push(item);
    }
  }

  if (!missing.length) return { byId, cacheHits, notes };

  const reply = await deps.request(sourceLang, lang, missing, { budgets, quiet });
  let added = 0;
  for (const item of missing) {
    const value = reply.translations[item.id];
    if (typeof value === 'string' && value.length) {
      byId[item.id] = value;
      memory[item.text] = value;
      added++;
    }
  }
  if (added) await deps.storage.saveTM(config.cacheKey, sourceLang.tag, lang.tag, memory);

  for (const issue of reply.issues || []) note({ code: 'provider-issue', detail: issue }, 'warn');

  if (!Object.keys(byId).length) {
    return {
      byId,
      cacheHits,
      fatal: reply.error || 'the provider returned no usable translations.',
      notes,
    };
  }
  if (reply.error) {
    note(
      { code: 'partial-translation', added, total: missing.length, reason: reply.error },
      'warn'
    );
  } else if (added < missing.length) {
    note({ code: 'strings-empty', count: missing.length - added }, 'warn');
  }
  return { byId, cacheHits, notes };
}

/** Never rejects: a prefetch nobody is awaiting yet must not become an unhandled rejection. */
function startLanguage(
  lang: LanguageDef,
  sourceLang: LanguageDef,
  allStrings: SourceString[],
  config: GenerateConfig,
  deps: PipelineDeps,
  budgets: Record<string, number> | undefined,
  quiet: boolean
): Promise<Resolved> {
  return resolveLanguage(lang, sourceLang, allStrings, config, deps, budgets, quiet).catch((e) => ({
    byId: {},
    cacheHits: 0,
    fatal: errorText(e),
    notes: [],
  }));
}

export async function generate(
  config: GenerateConfig,
  deps: PipelineDeps
): Promise<GenerateOutcome> {
  const { doc, token } = deps;
  const warnings: Warning[] = [];
  const scan = scanSelection(doc);
  const sources = scan.nodes;

  if (!sources.length) {
    return { status: 'error', message: 'Select at least one frame, group or component first.' };
  }

  const sourceLang = langByCode(config.sourceLanguage) || LANGUAGES[0];
  const targets: LanguageDef[] = [];
  for (const code of config.targets) {
    const lang = langByCode(code);
    if (lang) targets.push(lang);
  }
  if (!targets.length) {
    return { status: 'error', message: 'Select at least one target language.' };
  }

  const allStrings = scan.strings;
  if (!allStrings.length) {
    return {
      status: 'error',
      message: 'No text layers were found inside the selection. Nothing to localize.',
    };
  }

  const sourceById: Record<string, string> = {};
  for (const item of allStrings) sourceById[item.id] = item.text;

  const loadedFonts = new Set<string>();
  const failedFonts = new Set<string>();
  const scriptWarned = new Set<string>();

  deps.onProgress({
    label: 'Loading fonts…',
    langIndex: 0,
    langTotal: targets.length,
    frameIndex: 0,
    frameTotal: sources.length,
  });

  for (const source of sources) {
    await TE.loadFontsFor(TE.collectTextNodes(source), loadedFonts, failedFonts);
  }

  /* Measuring a fixed-size box means flipping it to auto-height and back, which
     Figma only permits once the font is loaded — hence after the loop above.
     Only providers that declare the capability can act on a budget, so nothing
     else pays for the measurement. */
  const useBudgets = config.capabilities.budgets && config.options.fitToLayout;
  const canShorten = config.capabilities.shorten && config.options.fitToLayout;
  const budgets = useBudgets ? computeBudgets(sources, allStrings) : undefined;

  /* Languages are resolved ahead of the cloning loop so a round-trip overlaps
     with drawing. Depth is the number of languages in flight at once, and it
     multiplies with the provider's batch concurrency — 2 × 2 is four requests
     to the same API, which is about as far as a free tier tolerates. */
  const queue: Array<Promise<Resolved>> = [];
  let nextToStart = 0;
  const fillQueue = () => {
    while (queue.length < PREFETCH_LANGUAGES && nextToStart < targets.length) {
      // Only the language being drawn right now may own the progress label.
      const quiet = nextToStart !== 0;
      queue.push(
        startLanguage(targets[nextToStart], sourceLang, allStrings, config, deps, budgets, quiet)
      );
      nextToStart++;
    }
  };
  fillQueue();

  const bounds = unionBounds(sources);
  const startX = firstColumnX(doc, bounds);
  const createdRoots: SceneNode[] = [];
  const sourceIds: Record<string, true> = {};
  for (const source of sources) sourceIds[source.id] = true;
  const existingByName = config.options.updateExisting
    ? indexExistingByName(doc, sourceIds)
    : new Map<string, SceneNode>();

  let framesCreated = 0;
  let layersTranslated = 0;
  let cacheHits = 0;
  let shortened = 0;

  for (let li = 0; li < targets.length; li++) {
    if (token.cancelled) break;
    const lang = targets[li];

    deps.onProgress({
      label: 'Translating into ' + lang.name + '…',
      langIndex: li + 1,
      langTotal: targets.length,
      frameIndex: 0,
      frameTotal: sources.length,
    });

    /* ---- 1. translations, then immediately top the queue back up ---- */
    const resolved = await (queue.shift() as Promise<Resolved>);
    fillQueue();
    if (token.cancelled) break;

    for (const note of resolved.notes) warnings.push(note);
    cacheHits += resolved.cacheHits;

    if (resolved.fatal) {
      warnings.push({
        frame: NONE,
        language: lang.code,
        layer: NONE,
        detail: { code: 'language-skipped', reason: resolved.fatal },
        severity: 'error',
      });
      continue;
    }

    /* ---- 2. container (created lazily: replaced frames never need one) ---- */
    const originX = startX + li * (bounds.width + GROUP_GAP);
    const originY = bounds.y;
    let container: Container | null = null;
    let containerTried = false;
    const getContainer = (): Container | null => {
      if (!config.options.groupPerLanguage) return null;
      if (!containerTried) {
        containerTried = true;
        container = createContainer(doc, lang, originX, originY, bounds);
        if (container) createdRoots.push(container);
      }
      return container;
    };

    /* ---- 3. clone + localize each frame ---- */
    const ctx: LocalizeContext = {
      lang,
      options: config.options,
      warnings,
      loadedFonts,
      failedFonts,
      scriptWarned,
      canShorten,
      overflows: [],
      token,
      sourceById,
    };

    for (let fi = 0; fi < sources.length; fi++) {
      if (token.cancelled) break;
      const source = sources[fi];

      deps.onProgress({
        label: lang.name + ' · ' + source.name,
        langIndex: li + 1,
        langTotal: targets.length,
        frameIndex: fi + 1,
        frameTotal: sources.length,
      });

      const srcBox = absBox(source);
      const targetName = localizedName(source.name, lang.code, config.options.suffixNaming);
      const previous = existingByName.get(targetName);

      let clone: SceneNode;
      try {
        clone = source.clone();
      } catch (e) {
        warnings.push({
          frame: source.name,
          language: lang.code,
          layer: NONE,
          detail: { code: 'frame-clone-failed', reason: errorText(e) },
          severity: 'error',
        });
        continue;
      }
      clone.name = targetName;

      let placedInContainer = false;
      if (previous) {
        // Take over the old frame's slot, then delete it. Replacing rather than
        // editing in place keeps the result identical to a fresh run — no stale
        // layers from a version of the design that no longer exists.
        existingByName.delete(targetName);
        const parent = previous.parent;
        const px = previous.x;
        const py = previous.y;
        try {
          if (parent && 'insertChild' in parent) {
            const index = (parent as ChildrenMixin).children.indexOf(previous);
            (parent as ChildrenMixin).insertChild(Math.max(0, index), clone);
          } else {
            doc.appendToPage(clone);
          }
          clone.x = px;
          clone.y = py;
        } catch (e) {
          swallow('generate: reusing the previous frame slot', e);
          doc.appendToPage(clone);
        }
        try {
          previous.remove();
        } catch (e) {
          swallow('generate: removing the previous frame', e);
        }
        warnings.push({
          frame: targetName,
          language: lang.code,
          layer: NONE,
          detail: { code: 'frame-replaced' },
          severity: 'info',
          nodeId: clone.id,
        });
      } else {
        try {
          doc.appendToPage(clone);
          clone.x = originX + (srcBox.x - bounds.x);
          clone.y = originY + (srcBox.y - bounds.y);

          const box = getContainer();
          if (box) {
            box.appendChild(clone);
            placedInContainer = true;
            if (box.type !== 'SECTION') {
              // Frames re-parent with local coordinates; sections keep absolute ones.
              clone.x = CONTAINER_PADDING + (srcBox.x - bounds.x);
              clone.y = CONTAINER_PADDING + (srcBox.y - bounds.y);
            }
          }
        } catch (e) {
          // Placement is cosmetic — a mis-placed frame beats no frame.
          swallow('generate: placing the clone', e);
        }
      }

      if (!placedInContainer) createdRoots.push(clone);
      framesCreated++;

      try {
        layersTranslated += await localizeFrame(clone, resolved.byId, ctx);
      } catch (e) {
        warnings.push({
          frame: clone.name,
          language: lang.code,
          layer: NONE,
          detail: { code: 'frame-partial', reason: errorText(e) },
          severity: 'error',
        });
      }

      await delay(0);
    }

    /* ---- 4. one batched "say it shorter" pass for whatever overflowed ---- */
    if (ctx.overflows.length && !token.cancelled) {
      deps.onProgress({
        label: 'Fitting ' + ctx.overflows.length + ' overflowing string(s) for ' + lang.name + '…',
        langIndex: li + 1,
        langTotal: targets.length,
        frameIndex: sources.length,
        frameTotal: sources.length,
      });
    }
    try {
      shortened += await runFitPass(ctx, deps.request);
    } catch (e) {
      warnings.push({
        frame: NONE,
        language: lang.code,
        layer: NONE,
        detail: { code: 'fit-pass-failed', reason: errorText(e) },
        /* Not 'info': the overflowing layers were handed to the fit pass and
           were consumed with it, so this is the *only* trace they leave. An
           info-level note is excluded from the summary count, which would have
           read "0 warnings" while nothing had actually been checked. */
        severity: 'warn',
      });
    }
  }

  if (!config.options.keepOriginals) {
    for (const source of sources) {
      try {
        source.name = localizedName(source.name, sourceLang.code, config.options.suffixNaming);
      } catch (e) {
        swallow('generate: renaming the source frame', e);
      }
    }
  }

  if (token.cancelled) {
    return { status: 'cancelled', framesCreated, warnings };
  }

  if (createdRoots.length) {
    try {
      doc.setSelection(createdRoots);
      doc.scrollAndZoomIntoView(createdRoots);
    } catch (e) {
      swallow('generate: selecting the result', e);
    }
  }

  const summary: GenerateSummary = {
    sourceFrames: sources.length,
    languages: targets.length,
    framesCreated,
    layersTranslated,
    cacheHits,
    shortened,
    warnings: warnings.filter((w) => w.severity !== 'info').length,
  };

  return { status: 'done', summary, warnings };
}

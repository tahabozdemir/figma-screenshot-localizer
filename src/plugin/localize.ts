/**
 * Localizing one cloned frame: writing the text, following the language's
 * typographic rules, and the two-stage fit (measure a budget up front, ask for
 * a shorter wording for whatever still overflows).
 */

import type { CancellationToken } from '../shared/cancellation';
import { SCRIPT_LABEL } from '../shared/languages';
import { swallow } from '../shared/log';
import type { GenerateOptions, LanguageDef, SourceString } from '../shared/types';
import { hashString } from '../shared/util';
import { NONE, type Warning, type WarningDetail } from '../shared/warnings';
import type { Severity } from '../shared/types';
import * as TE from './text-engine';

/** Above this the layout is roomy enough that a budget is only prompt noise. */
export const BUDGET_SLACK = 1.6;

export interface TranslationReply {
  translations: Record<string, string>;
  error?: string;
  issues?: string[];
}

export interface RequestOptions {
  /** stringId -> soft character budget measured from the layout. */
  budgets?: Record<string, number>;
  /** Ask for a shorter rewrite of already-translated text. */
  shorten?: boolean;
  /** Prefetch for a later language: must not hijack the progress label. */
  quiet?: boolean;
}

export type RequestTranslations = (
  source: LanguageDef,
  target: LanguageDef,
  strings: SourceString[],
  opts?: RequestOptions
) => Promise<TranslationReply>;

/** A layer whose translation overflowed, queued for the shorten pass. */
interface Overflow {
  node: TextNode;
  root: SceneNode;
  frame: string;
  layer: string;
  /** Text currently on the layer — what the model is asked to shorten. */
  text: string;
  /** Id used for this fit request only; assigned when the batch is built. */
  requestId: string;
  maxChars: number;
  /** Length of the source string, so growth can be restated after a rewrite. */
  sourceLength: number;
  fit: TE.FitResult;
}

export interface LocalizeContext {
  lang: LanguageDef;
  options: GenerateOptions;
  warnings: Warning[];
  loadedFonts: Set<string>;
  failedFonts: Set<string>;
  scriptWarned: Set<string>;
  /** Only when the provider can rewrite text: overflows get a second chance. */
  canShorten: boolean;
  overflows: Overflow[];
  token: CancellationToken;
  /**
   * id -> the source text it was derived from.
   *
   * The id is a 64-bit-ish hash, so a collision is unlikely but possible, and
   * its failure mode is the worst kind: a layer silently gets another layer's
   * translation. Verifying the source text before writing turns that into a
   * skipped layer and a warning.
   */
  sourceById: Record<string, string>;
}

export function warn(
  ctx: LocalizeContext,
  frame: string,
  layer: string,
  detail: WarningDetail,
  severity: Severity,
  nodeId?: string
): void {
  ctx.warnings.push({ frame, language: ctx.lang.code, layer, detail, severity, nodeId });
}

/**
 * How much room each unique string actually has, in characters, measured on the
 * source layers before anything is cloned. The tightest layer wins: one string
 * may appear in a roomy paragraph and a cramped button.
 *
 * The budget is never allowed below the source length, since a translation that
 * is no longer than the text it replaces fits by construction.
 */
export function computeBudgets(
  sources: SceneNode[],
  strings: SourceString[]
): Record<string, number> {
  const sourceLength: Record<string, number> = {};
  for (const item of strings) sourceLength[item.id] = item.text.length;

  const tightest: Record<string, number> = {};
  for (const root of sources) {
    for (const node of TE.collectTextNodes(root)) {
      const text = node.characters;
      if (!text || !text.trim()) continue;
      const capacity = TE.capacityChars(node, TE.availableFor(node, root));
      if (capacity === null) continue;
      const id = hashString(text);
      const budget = Math.max(text.length, capacity);
      const previous = tightest[id];
      tightest[id] = previous === undefined ? budget : Math.min(previous, budget);
    }
  }

  const out: Record<string, number> = {};
  for (const id of Object.keys(tightest)) {
    const length = sourceLength[id];
    if (length && tightest[id] < length * BUDGET_SLACK) out[id] = tightest[id];
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* One frame                                                           */
/* ------------------------------------------------------------------ */

export async function localizeFrame(
  root: SceneNode,
  translationsById: Record<string, string>,
  ctx: LocalizeContext
): Promise<number> {
  const texts = TE.collectTextNodes(root);
  await TE.loadFontsFor(texts, ctx.loadedFonts, ctx.failedFonts);

  const { options, lang } = ctx;
  const measure = options.autoAdjust || options.detectOverflow;
  let translated = 0;
  let rtlNoted = false;

  for (const node of texts) {
    if (ctx.token.cancelled) break;
    const original = node.characters;
    if (!original || !original.trim()) continue;

    const layerName = node.name;
    const id = hashString(original);

    const knownSource = ctx.sourceById[id];
    if (knownSource !== undefined && knownSource !== original) {
      warn(ctx, root.name, layerName, { code: 'hash-collision' }, 'error', node.id);
      continue;
    }

    const target = translationsById[id];
    if (typeof target !== 'string' || !target.length) {
      warn(ctx, root.name, layerName, { code: 'no-translation' }, 'warn', node.id);
      continue;
    }

    const badFont = TE.nodeHasUnloadableFont(node, ctx.failedFonts);
    if (badFont || node.hasMissingFont) {
      warn(
        ctx,
        root.name,
        layerName,
        { code: 'font-unavailable', font: badFont ? badFont.family + ' ' + badFont.style : undefined },
        'error',
        node.id
      );
      continue;
    }

    // Capture how tight the source already was, before we touch the content.
    let wasTight = false;
    if (measure) {
      const availBefore = TE.availableFor(node, root);
      wasTight = TE.fillRatio(node, availBefore) > 0.9;
    }

    const changed = target !== original;

    if (changed) {
      const mode = TE.setTextPreservingStyle(node, target, options.preserveFormatting);
      if (mode === 'failed') {
        warn(ctx, root.name, layerName, { code: 'text-write-failed' }, 'error', node.id);
        continue;
      }
      if (mode === 'remapped') {
        warn(ctx, root.name, layerName, { code: 'style-remapped' }, 'info', node.id);
      }
    }
    translated++;

    /* Alignment and glyph coverage follow the language, not the diff. A brand
       name that survives translation unchanged still has to sit on the right
       in Arabic, and still needs a font that can draw it. */
    if (lang.rtl) {
      try {
        if (node.textAlignHorizontal === 'LEFT') node.textAlignHorizontal = 'RIGHT';
        else if (node.textAlignHorizontal === 'RIGHT') node.textAlignHorizontal = 'LEFT';
      } catch (e) {
        // A locked alignment is not worth failing the layer over.
        swallow('rtl: mirroring textAlignHorizontal', e);
      }
      if (!rtlNoted) {
        rtlNoted = true;
        warn(ctx, root.name, NONE, { code: 'rtl-mirrored', language: lang.name }, 'info', root.id);
      }
    }

    if (lang.script !== 'latin') {
      for (const font of TE.fontsOf(node)) {
        const key = font.family + '|' + lang.script;
        if (ctx.scriptWarned.has(key)) continue;
        ctx.scriptWarned.add(key);
        warn(
          ctx,
          root.name,
          layerName,
          { code: 'script-coverage', font: font.family, script: SCRIPT_LABEL[lang.script] },
          'info',
          node.id
        );
      }
    }

    if (!changed || !measure) continue;

    const avail = TE.availableFor(node, root);
    const fit = TE.autoFit(node, avail, options.autoAdjust, wasTight);
    const growth = original.length ? (target.length - original.length) / original.length : 0;

    if (!fit.fits) {
      if (ctx.canShorten) {
        const capacity = TE.capacityChars(node, avail);
        if (capacity !== null && capacity < node.characters.length) {
          // Queue it: the model gets one chance to say it shorter before this
          // turns into a warning the designer has to fix by hand.
          ctx.overflows.push({
            node,
            root,
            frame: root.name,
            layer: layerName,
            text: node.characters,
            requestId: '',
            maxChars: capacity,
            sourceLength: original.length,
            fit,
          });
          continue;
        }
      }
      if (options.detectOverflow) {
        warn(ctx, root.name, layerName, overflowDetail(fit, growth, options.autoAdjust, false), 'warn', node.id);
      }
    } else if (options.detectOverflow && fit.fontScale < 0.999) {
      warn(
        ctx,
        root.name,
        layerName,
        {
          code: 'font-scaled',
          fontScale: fit.fontScale,
          letterSpacingDelta: fit.letterSpacingDelta,
        },
        'info',
        node.id
      );
    } else if (options.detectOverflow && growth > 0.2 && TE.fillRatio(node, avail) > 0.85) {
      // Fits, but only just — worth a look without drowning the list in noise.
      warn(ctx, root.name, layerName, { code: 'tight-fit', growth }, 'info', node.id);
    }
  }

  return translated;
}

function overflowDetail(
  fit: TE.FitResult,
  growth: number,
  autoAdjust: boolean,
  shortened: boolean
): WarningDetail {
  return {
    code: 'overflow',
    overflowH: fit.overflowH,
    overflowW: fit.overflowW,
    growth,
    autoAdjust,
    fontScale: fit.fontScale,
    shortened,
  };
}

/* ------------------------------------------------------------------ */
/* Fit pass                                                            */
/* ------------------------------------------------------------------ */

/**
 * Second chance for the layers that overflowed: one batched request asking the
 * model for a shorter wording of its own translation, within the character
 * budget the layout actually has. Only layers that are still too long after
 * this end up as warnings.
 *
 * Both `source` and `target` are the target language — this is a rewrite, not
 * a translation.
 */
export async function runFitPass(
  ctx: LocalizeContext,
  request: RequestTranslations
): Promise<number> {
  const items = ctx.overflows;
  ctx.overflows = [];

  /** Growth against the source, restated from whatever is on the layer now. */
  const growthOf = (item: Overflow): number =>
    item.sourceLength ? (item.node.characters.length - item.sourceLength) / item.sourceLength : 0;

  const reportUnchanged = () => {
    if (!ctx.options.detectOverflow) return;
    for (const item of items) {
      warn(
        ctx,
        item.frame,
        item.layer,
        overflowDetail(item.fit, growthOf(item), ctx.options.autoAdjust, false),
        'warn',
        item.node.id
      );
    }
  };

  if (!items.length || ctx.token.cancelled) {
    // Nothing to ask, but the first-pass verdict still has to be reported.
    reportUnchanged();
    return 0;
  }

  /* Group by the text itself and mint ids per request rather than hashing the
     translation: two different rewrites sharing a hash would otherwise get one
     another's shortening. */
  const byText = new Map<string, SourceString>();
  const budgets: Record<string, number> = {};
  for (const item of items) {
    let entry = byText.get(item.text);
    if (!entry) {
      entry = { id: 'fit' + byText.size, text: item.text, count: 0 };
      byText.set(item.text, entry);
    }
    entry.count++;
    item.requestId = entry.id;
    const previous = budgets[entry.id];
    budgets[entry.id] = previous === undefined ? item.maxChars : Math.min(previous, item.maxChars);
  }

  const reply = await request(ctx.lang, ctx.lang, Array.from(byText.values()), {
    budgets,
    shorten: true,
  });

  if (reply.error) {
    warn(ctx, NONE, NONE, { code: 'shorten-failed', reason: reply.error }, 'info');
  }

  let rescued = 0;
  for (const item of items) {
    let fit = item.fit;
    let applied = false;

    const shorter = reply.translations[item.requestId];
    if (typeof shorter === 'string' && shorter.trim().length && shorter !== item.text) {
      const mode = TE.setTextPreservingStyle(item.node, shorter, ctx.options.preserveFormatting);
      if (mode !== 'failed') {
        applied = true;
        // Start the fit from the designer's own sizes again, so the 85% floor
        // is measured against the original and not against the shrunk state.
        TE.undoFit(item.node, item.fit);
        const avail = TE.availableFor(item.node, item.root);
        fit = TE.autoFit(item.node, avail, ctx.options.autoAdjust, false);
      }
    }

    if (fit.fits) {
      rescued++;
      if (applied && ctx.options.detectOverflow) {
        warn(ctx, item.frame, item.layer, { code: 'shortened', text: shorter }, 'info', item.node.id);
      }
    } else if (ctx.options.detectOverflow) {
      warn(
        ctx,
        item.frame,
        item.layer,
        overflowDetail(fit, growthOf(item), ctx.options.autoAdjust, applied),
        'warn',
        item.node.id
      );
    }
  }
  return rescued;
}

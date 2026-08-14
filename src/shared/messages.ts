/**
 * The message protocol between the plugin sandbox and the UI iframe, and the
 * validators that guard both ends of it.
 *
 * Neither side may assume the other is the build it shipped with: Figma keeps
 * an old iframe alive across a rebuild, and `window.onmessage` in a browser
 * context will happily deliver anything. Every inbound message is therefore
 * parsed into a known shape or dropped — the sandbox in particular must never
 * mutate a document off an unvalidated payload.
 */

import {
  normalizeFolders,
  normalizeManual,
  normalizeOptions,
  normalizeSecrets,
  normalizeSettings,
} from './defaults';
import type {
  FrameSummary,
  GenerateConfig,
  GenerateSummary,
  LanguageDef,
  ManualTable,
  PersistedSettings,
  Secrets,
  SourceString,
  TranslationMode,
} from './types';
import type { Warning } from './warnings';

export type UiToPlugin =
  | { type: 'ui-ready' }
  | { type: 'refresh-selection' }
  | { type: 'scan' }
  | { type: 'generate'; config: GenerateConfig }
  | {
      type: 'translations';
      requestId: string;
      translations: Record<string, string>;
      error?: string;
      /** Non-fatal quality notes (missing placeholders, short batches, …). */
      issues?: string[];
    }
  | { type: 'cancel' }
  | { type: 'save-settings'; settings: PersistedSettings }
  | { type: 'save-secrets'; secrets: Secrets }
  | { type: 'save-manual'; manual: ManualTable }
  | { type: 'clear-cache' }
  | { type: 'select-nodes'; ids: string[] }
  | { type: 'resize'; width: number; height: number }
  | {
      /** CORS escape hatch: perform this request from the plugin sandbox. */
      type: 'http-request';
      requestId: string;
      url: string;
      method: 'GET' | 'POST';
      headers: Record<string, string>;
      body?: string;
    }
  | { type: 'close' };

export type PluginToUi =
  | {
      type: 'settings';
      settings: PersistedSettings;
      secrets: Secrets;
      manual: ManualTable;
    }
  | { type: 'selection'; frames: FrameSummary[]; textCount: number }
  | { type: 'strings'; items: SourceString[] }
  | {
      type: 'translate-request';
      requestId: string;
      target: LanguageDef;
      source: LanguageDef;
      strings: SourceString[];
      /** stringId -> soft character budget measured from the layout. */
      budgets?: Record<string, number>;
      /**
       * Second pass: `strings` already hold *translated* text that did not fit,
       * and the model is asked to shorten it in place rather than translate.
       */
      shorten?: boolean;
      /** Prefetch for a later language — must not touch the progress label. */
      quiet?: boolean;
    }
  | {
      type: 'progress';
      label: string;
      langIndex: number;
      langTotal: number;
      frameIndex: number;
      frameTotal: number;
    }
  | { type: 'done'; summary: GenerateSummary; warnings: Warning[] }
  | { type: 'error'; message: string }
  | {
      type: 'http-response';
      requestId: string;
      ok: boolean;
      status: number;
      statusText: string;
      headers: Record<string, string>;
      body: string;
      error?: string;
      /** false when retrying can never help (e.g. no sandbox fetch at all). */
      retryable?: boolean;
    }
  | { type: 'cancelled' };

/* ------------------------------------------------------------------ */
/* Primitive guards                                                    */
/* ------------------------------------------------------------------ */

type Bag = Record<string, unknown>;

function bag(value: unknown): Bag | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Bag) : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && isFinite(value) ? value : fallback;
}

function stringMap(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const src = bag(value);
  if (!src) return out;
  for (const key of Object.keys(src)) {
    const item = src[key];
    if (typeof item === 'string') out[key] = item;
  }
  return out;
}

function numberMap(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  const src = bag(value);
  if (!src) return out;
  for (const key of Object.keys(src)) {
    const item = src[key];
    if (typeof item === 'number' && isFinite(item)) out[key] = item;
  }
  return out;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) if (typeof item === 'string') out.push(item);
  return out;
}

function sourceStrings(value: unknown): SourceString[] {
  if (!Array.isArray(value)) return [];
  const out: SourceString[] = [];
  for (const raw of value) {
    const item = bag(raw);
    if (!item) continue;
    if (typeof item.id !== 'string' || typeof item.text !== 'string') continue;
    out.push({ id: item.id, text: item.text, count: num(item.count, 1) });
  }
  return out;
}

function language(value: unknown): LanguageDef | null {
  const item = bag(value);
  if (!item) return null;
  if (typeof item.code !== 'string' || typeof item.tag !== 'string') return null;
  return {
    code: item.code,
    tag: item.tag,
    name: text(item.name) || item.code,
    rtl: item.rtl === true,
    script: (['latin', 'cyrillic', 'cjk', 'arabic', 'thai'].indexOf(String(item.script)) >= 0
      ? item.script
      : 'latin') as LanguageDef['script'],
  };
}

/** Every field is rendered straight into the summary, so a gap reads as "undefined". */
function summaryOf(value: unknown): GenerateSummary {
  const item = bag(value) || {};
  return {
    sourceFrames: num(item.sourceFrames),
    languages: num(item.languages),
    framesCreated: num(item.framesCreated),
    layersTranslated: num(item.layersTranslated),
    cacheHits: num(item.cacheHits),
    shortened: num(item.shortened),
    warnings: num(item.warnings),
  };
}

function generateConfig(value: unknown): GenerateConfig | null {
  const item = bag(value);
  if (!item) return null;
  const targets = stringList(item.targets);
  if (!targets.length) return null;
  const caps = bag(item.capabilities) || {};
  return {
    sourceLanguage: text(item.sourceLanguage) || 'EN',
    targets,
    mode: text(item.mode) as TranslationMode,
    options: normalizeOptions(item.options),
    exportFolders: normalizeFolders(item.exportFolders),
    doNotTranslate: stringList(item.doNotTranslate),
    cacheKey: typeof item.cacheKey === 'string' && item.cacheKey ? item.cacheKey : null,
    capabilities: { shorten: caps.shorten === true, budgets: caps.budgets === true },
  };
}

/* ------------------------------------------------------------------ */
/* Inbound parsing                                                     */
/* ------------------------------------------------------------------ */

/** Validates a message the UI sent to the sandbox. Returns null to drop it. */
export function parseUiToPlugin(raw: unknown): UiToPlugin | null {
  const msg = bag(raw);
  if (!msg || typeof msg.type !== 'string') return null;

  switch (msg.type) {
    case 'ui-ready':
    case 'refresh-selection':
    case 'scan':
    case 'cancel':
    case 'clear-cache':
    case 'close':
      return { type: msg.type };

    case 'generate': {
      const config = generateConfig(msg.config);
      return config ? { type: 'generate', config } : null;
    }

    case 'translations': {
      if (typeof msg.requestId !== 'string') return null;
      return {
        type: 'translations',
        requestId: msg.requestId,
        translations: stringMap(msg.translations),
        error: typeof msg.error === 'string' ? msg.error : undefined,
        issues: stringList(msg.issues),
      };
    }

    case 'save-settings':
      return { type: 'save-settings', settings: normalizeSettings(msg.settings) };

    case 'save-secrets':
      return { type: 'save-secrets', secrets: normalizeSecrets(msg.secrets) };

    case 'save-manual':
      return { type: 'save-manual', manual: normalizeManual(msg.manual) };

    case 'select-nodes':
      return { type: 'select-nodes', ids: stringList(msg.ids) };

    case 'resize':
      return { type: 'resize', width: num(msg.width), height: num(msg.height) };

    case 'http-request': {
      const method = msg.method === 'POST' ? 'POST' : 'GET';
      if (typeof msg.requestId !== 'string' || typeof msg.url !== 'string') return null;
      return {
        type: 'http-request',
        requestId: msg.requestId,
        url: msg.url,
        method,
        headers: stringMap(msg.headers),
        body: typeof msg.body === 'string' ? msg.body : undefined,
      };
    }

    default:
      return null;
  }
}

/**
 * Validates a message the sandbox sent to the UI.
 *
 * Lighter than the inbound direction on purpose: this side only paints a panel,
 * and `warnings`/`summary` are rendered defensively anyway. The checks that
 * matter are the ones that would otherwise throw during render.
 */
export function parsePluginToUi(raw: unknown): PluginToUi | null {
  const msg = bag(raw);
  if (!msg || typeof msg.type !== 'string') return null;

  switch (msg.type) {
    case 'settings':
      return {
        type: 'settings',
        settings: normalizeSettings(msg.settings),
        secrets: normalizeSecrets(msg.secrets),
        manual: normalizeManual(msg.manual),
      };

    case 'selection': {
      const frames: FrameSummary[] = [];
      if (Array.isArray(msg.frames)) {
        for (const raw2 of msg.frames) {
          const f = bag(raw2);
          if (f) frames.push({ id: text(f.id), name: text(f.name), textCount: num(f.textCount) });
        }
      }
      return { type: 'selection', frames, textCount: num(msg.textCount) };
    }

    case 'strings':
      return { type: 'strings', items: sourceStrings(msg.items) };

    case 'translate-request': {
      const source = language(msg.source);
      const target = language(msg.target);
      if (typeof msg.requestId !== 'string' || !source || !target) return null;
      return {
        type: 'translate-request',
        requestId: msg.requestId,
        source,
        target,
        strings: sourceStrings(msg.strings),
        budgets: msg.budgets ? numberMap(msg.budgets) : undefined,
        shorten: msg.shorten === true,
        quiet: msg.quiet === true,
      };
    }

    case 'progress':
      return {
        type: 'progress',
        label: text(msg.label),
        langIndex: num(msg.langIndex),
        langTotal: num(msg.langTotal, 1),
        frameIndex: num(msg.frameIndex),
        frameTotal: num(msg.frameTotal, 1),
      };

    case 'done':
      return {
        type: 'done',
        summary: summaryOf(msg.summary),
        warnings: Array.isArray(msg.warnings) ? (msg.warnings as Warning[]) : [],
      };

    case 'error':
      return { type: 'error', message: text(msg.message) };

    case 'http-response': {
      if (typeof msg.requestId !== 'string') return null;
      return {
        type: 'http-response',
        requestId: msg.requestId,
        ok: msg.ok === true,
        status: num(msg.status),
        statusText: text(msg.statusText),
        headers: stringMap(msg.headers),
        body: text(msg.body),
        error: typeof msg.error === 'string' ? msg.error : undefined,
        retryable: msg.retryable !== false,
      };
    }

    case 'cancelled':
      return { type: 'cancelled' };

    default:
      return null;
  }
}

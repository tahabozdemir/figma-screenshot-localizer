/**
 * The one copy of every default, plus the normalizers that turn whatever came
 * out of storage (or across a postMessage) into a complete object.
 *
 * Both threads used to keep their own copy of these literals and hand-sync
 * them. They are shared now, so a new option cannot exist on one side only.
 */

import type { GenerateOptions, PersistedSettings, Secrets, TranslationMode } from './types';

export const DEFAULT_OPTIONS: GenerateOptions = {
  groupPerLanguage: false,
  keepOriginals: true,
  autoAdjust: true,
  detectOverflow: true,
  preserveFormatting: true,
  suffixNaming: true,
  updateExisting: false,
  fitToLayout: true,
};

export const DEFAULT_SETTINGS: PersistedSettings = {
  sourceLanguage: 'EN',
  targets: [],
  mode: 'manual',
  options: DEFAULT_OPTIONS,
  doNotTranslate: '',
  glossary: '',
  openaiModel: 'gpt-4o-mini',
  geminiModel: 'gemini-2.0-flash',
  debug: false,
};

export const DEFAULT_SECRETS: Secrets = {
  openaiKey: '',
  geminiKey: '',
  googleKey: '',
  deeplKey: '',
  deeplFreeKey: '',
};

const MODES: TranslationMode[] = [
  'manual',
  'openai',
  'gemini',
  'google',
  'google-free',
  'deepl',
  'deepl-free',
];

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) if (typeof item === 'string') out.push(item);
  return out;
}

export function normalizeOptions(raw: unknown): GenerateOptions {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Partial<GenerateOptions>;
  const out = {} as GenerateOptions;
  for (const key of Object.keys(DEFAULT_OPTIONS) as Array<keyof GenerateOptions>) {
    out[key] = bool(src[key], DEFAULT_OPTIONS[key]);
  }
  return out;
}

/** Fills every field, drops anything unrecognized, never throws. */
export function normalizeSettings(raw: unknown): PersistedSettings {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Partial<PersistedSettings>;
  const mode =
    MODES.indexOf(src.mode as TranslationMode) >= 0
      ? (src.mode as TranslationMode)
      : DEFAULT_SETTINGS.mode;
  return {
    sourceLanguage: str(src.sourceLanguage, DEFAULT_SETTINGS.sourceLanguage),
    targets: stringList(src.targets),
    mode,
    options: normalizeOptions(src.options),
    doNotTranslate: str(src.doNotTranslate, ''),
    glossary: str(src.glossary, ''),
    openaiModel: str(src.openaiModel, DEFAULT_SETTINGS.openaiModel),
    geminiModel: str(src.geminiModel, DEFAULT_SETTINGS.geminiModel),
    debug: bool(src.debug, false),
  };
}

export function normalizeSecrets(raw: unknown): Secrets {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Partial<Secrets>;
  const out = {} as Secrets;
  for (const key of Object.keys(DEFAULT_SECRETS) as Array<keyof Secrets>) {
    out[key] = str(src[key], '');
  }
  return out;
}

/** manual[lang][id] = text, with every non-string value dropped. */
export function normalizeManual(raw: unknown): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  if (!raw || typeof raw !== 'object') return out;
  const table = raw as Record<string, unknown>;
  for (const code of Object.keys(table)) {
    const bag = table[code];
    if (!bag || typeof bag !== 'object') continue;
    const kept: Record<string, string> = {};
    const entries = bag as Record<string, unknown>;
    for (const id of Object.keys(entries)) {
      const value = entries[id];
      if (typeof value === 'string') kept[id] = value;
    }
    out[code] = kept;
  }
  return out;
}

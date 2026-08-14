/**
 * Domain types shared by the plugin sandbox and the UI iframe.
 * This file must stay free of any `figma.*` or `document.*` usage.
 */

/**
 * The provider id space — the vocabulary of the wire protocol.
 *
 * `providers/registry.ts` is typed as `Record<TranslationMode, …>`, so adding a
 * member here without a descriptor there is a compile error, and everything
 * else about a provider (label, credential fields, capabilities, cache bucket,
 * UI panel) is read from that descriptor rather than re-listed per call site.
 */
export type TranslationMode =
  'manual' | 'openai' | 'gemini' | 'google' | 'google-free' | 'deepl' | 'deepl-free';

export type Severity = 'error' | 'warn' | 'info';

/** Codes an engine wants instead of the BCP-47 tag. Absent = use the tag. */
export interface EngineCodes {
  google?: string;
  deeplSource?: string;
  deeplTarget?: string;
}

/**
 * The locale each store files a screenshot set under, when it isn't the plain
 * BCP-47 tag. The two stores disagree often enough — `ar-SA` vs `ar`,
 * `zh-Hans` vs `zh-CN` — that the folder names cannot be shared.
 */
export interface StoreCodes {
  /** App Store Connect, e.g. "ar-SA", "zh-Hans". */
  appStore?: string;
  /** Google Play Console, e.g. "ar", "zh-CN", "de-DE". */
  play?: string;
}

/**
 * Which store's locale becomes an export folder in the frame name.
 * `none` keeps the flat, tagged naming.
 */
export type FolderScheme = 'none' | 'appStore' | 'play' | 'tag';

export interface LanguageDef {
  /** Display / frame-naming code, e.g. "ZH-CN". */
  code: string;
  /** BCP-47-ish tag handed to the AI providers, e.g. "zh-Hans". */
  tag: string;
  /** Human readable name, e.g. "Chinese Simplified". */
  name: string;
  rtl: boolean;
  script: 'latin' | 'cyrillic' | 'cjk' | 'arabic' | 'thai';
  engine?: EngineCodes;
  /** Store locales that differ from the tag. Absent = the tag is the locale. */
  stores?: StoreCodes;
}

/** What a provider is able to do. Declared by the registry, never inferred. */
export interface ProviderCapabilities {
  /** Can rewrite already-translated text shorter (the fit pass). */
  shorten: boolean;
  /** Can act on a per-string character budget. */
  budgets: boolean;
}

export interface GenerateOptions {
  /** Wrap every language's output in its own section / container frame. */
  groupPerLanguage: boolean;
  /** ON: never touch the sources. OFF: sources get the source-language tag in their name. */
  keepOriginals: boolean;
  autoAdjust: boolean;
  detectOverflow: boolean;
  preserveFormatting: boolean;
  /** true -> "Hero_DE", false -> "[DE] Hero". Ignored once folders are on. */
  suffixNaming: boolean;
  /**
   * Replace an earlier run's frames (matched by name) in place instead of
   * adding another column. The old frame's position and parent are reused.
   */
  updateExisting: boolean;
  /**
   * Hand the model a per-string character budget measured from the layout, then
   * ask it to shorten anything that still overflows. Only has an effect when
   * the selected provider declares the matching capability.
   */
  fitToLayout: boolean;
}

/** Everything frame naming reads. `exportFolders` wins over `suffixNaming`. */
export interface NamingOptions {
  suffixNaming: boolean;
  exportFolders: FolderScheme;
}

export interface GenerateConfig {
  sourceLanguage: string;
  targets: string[];
  mode: TranslationMode;
  options: GenerateOptions;
  /**
   * Which store's locale the frames are named into, e.g. "ar-SA/01_Hero".
   * Not part of `options` because that blob is booleans only.
   */
  exportFolders: FolderScheme;
  /** Product names / proper nouns the model must leave untouched. */
  doNotTranslate: string[];
  /**
   * Translation-memory bucket, or null to never cache.
   *
   * Computed in the UI from the provider descriptor, so it can include the
   * things that actually change the output — the engine *and* the model id.
   * The sandbox stores against it without knowing what a provider is.
   */
  cacheKey: string | null;
  capabilities: ProviderCapabilities;
}

export interface SourceString {
  /** Stable hash of `text` — identical strings share one id and one translation. */
  id: string;
  text: string;
  /** How many text layers in the selection carry this exact string. */
  count: number;
}

/** `term` -> per-language-code forced translation, parsed from the glossary field. */
export interface GlossaryEntry {
  term: string;
  byLang: Record<string, string>;
}

export interface FrameSummary {
  id: string;
  name: string;
  textCount: number;
}

export interface GenerateSummary {
  sourceFrames: number;
  languages: number;
  framesCreated: number;
  layersTranslated: number;
  cacheHits: number;
  /** Layers rescued by the fit pass asking the model for a shorter wording. */
  shortened: number;
  warnings: number;
}

/* ------------------------------------------------------------------ */
/* Persisted state                                                     */
/* ------------------------------------------------------------------ */

/**
 * API keys, stored under their own storage key and written only when a field is
 * committed — never on every keystroke, and never mixed into the settings blob
 * that the panel saves constantly.
 */
export interface Secrets {
  openaiKey: string;
  geminiKey: string;
  googleKey: string;
  deeplKey: string;
  deeplFreeKey: string;
}

export type SecretKey = keyof Secrets;

export interface PersistedSettings {
  sourceLanguage: string;
  targets: string[];
  mode: TranslationMode;
  options: GenerateOptions;
  /** Store whose locales become export folders in the frame names. */
  exportFolders: FolderScheme;
  doNotTranslate: string;
  /** Raw glossary text, one `term = XX: translation, YY: translation` per line. */
  glossary: string;
  openaiModel: string;
  geminiModel: string;
  /** Log the errors the plugin normally swallows, for bug reports. */
  debug: boolean;
}

/** manual[languageCode][stringId] = translation typed by hand. */
export type ManualTable = Record<string, Record<string, string>>;

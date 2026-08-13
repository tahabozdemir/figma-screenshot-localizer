import type { GlossaryEntry, LanguageDef, SourceString } from '../shared/types';

export interface TranslateRequest {
  source: LanguageDef;
  target: LanguageDef;
  strings: SourceString[];
  /**
   * stringId -> soft character budget measured from the Figma layout. Only the
   * providers that declare the `budgets` capability act on it.
   */
  budgets?: Record<string, number>;
}

export interface ProviderContext {
  doNotTranslate: string[];
  /** Forced translations for specific terms. AI providers only. */
  glossary?: GlossaryEntry[];
  onProgress?: (done: number, total: number) => void;
  isCancelled?: () => boolean;
  /** Aborts in-flight requests when the run is cancelled. */
  signal?: AbortSignal;
}

export interface TranslateResult {
  translations: Record<string, string>;
  /** Set when something went wrong but earlier batches still succeeded. */
  error?: string;
  /** Non-fatal quality notes surfaced in the plugin's warning list. */
  issues: string[];
}

export interface TranslationProvider {
  readonly id: string;
  readonly name: string;
  translate(req: TranslateRequest, ctx: ProviderContext): Promise<TranslateResult>;
  /**
   * Optional second pass. `req.strings` hold text that is *already* in the
   * target language but overflowed its box; the provider returns a shorter
   * rendition in the same language.
   */
  shorten?(req: TranslateRequest, ctx: ProviderContext): Promise<TranslateResult>;
}

/** How many strings go into one request, and how many requests run at once. */
export interface ChunkPolicy {
  maxItems: number;
  maxChars: number;
  concurrency: number;
}

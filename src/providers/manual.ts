import { qualityIssues } from './protect';
import type {
  ProviderContext,
  TranslateRequest,
  TranslateResult,
  TranslationProvider,
} from './types';

/** Reads what the designer typed. The only provider that never touches the network. */
export class ManualProvider implements TranslationProvider {
  readonly id = 'manual';
  readonly name = 'Manual';

  /** table[languageCode][stringId] = translation */
  constructor(private readonly table: Record<string, Record<string, string>>) {}

  // Not `async`: there is nothing to await, and the interface only asks for a Promise.
  translate(req: TranslateRequest, ctx: ProviderContext): Promise<TranslateResult> {
    const entries = this.table[req.target.code] || {};
    const translations: Record<string, string> = {};
    let missing = 0;
    for (const s of req.strings) {
      const value = entries[s.id];
      if (typeof value === 'string' && value.trim().length) translations[s.id] = value;
      else missing++;
    }
    return Promise.resolve({
      translations,
      error: missing
        ? missing + ' string(s) have no manual translation for ' + req.target.name + '.'
        : undefined,
      issues: qualityIssues(req.strings, translations, ctx.doNotTranslate || []),
    });
  }
}

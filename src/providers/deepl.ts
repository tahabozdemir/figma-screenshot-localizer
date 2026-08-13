import { DEEPL_POLICY, ResponseError, httpError, runChunks } from './base';
import { deeplSource, deeplTarget } from '../shared/languages';
import { markProtected, unmarkProtected } from './protect';
import { parseJson, type Transport } from './transport';
import type {
  ChunkPolicy,
  ProviderContext,
  TranslateRequest,
  TranslateResult,
  TranslationProvider,
} from './types';

export const DEEPL_PRO_URL = 'https://api.deepl.com/v2/translate';
export const DEEPL_FREE_URL = 'https://api-free.deepl.com/v2/translate';

/** A key ending in ":fx" belongs to the Free tier and only works on api-free. */
export function isFreeKey(apiKey: string): boolean {
  return /:fx$/i.test(apiKey.trim());
}

export class DeepLProvider implements TranslationProvider {
  readonly id: string;
  readonly name: string;

  private readonly transport: Transport;
  private readonly policy: ChunkPolicy;
  private readonly apiKey: string;
  private readonly freeTier: boolean;

  constructor(deps: {
    transport: Transport;
    apiKey: string;
    freeTier: boolean;
    policy?: ChunkPolicy;
  }) {
    this.transport = deps.transport;
    this.policy = deps.policy || DEEPL_POLICY;
    this.apiKey = deps.apiKey;
    this.freeTier = deps.freeTier;
    this.id = deps.freeTier ? 'deepl-free' : 'deepl';
    this.name = deps.freeTier ? 'DeepL (Free API)' : 'DeepL (Pro API)';
  }

  async translate(req: TranslateRequest, ctx: ProviderContext): Promise<TranslateResult> {
    if (!this.apiKey) {
      return { translations: {}, error: 'No ' + this.name + ' auth key entered.', issues: [] };
    }

    // Routing by the key rather than the menu choice turns a confusing 403 into a note.
    const keyIsFree = isFreeKey(this.apiKey);
    const notes: string[] = [];
    if (keyIsFree !== this.freeTier) {
      notes.push(
        'The key you entered is a ' +
          (keyIsFree ? 'Free' : 'Pro') +
          ' DeepL key, so the ' +
          (keyIsFree ? 'api-free.deepl.com' : 'api.deepl.com') +
          ' endpoint was used instead of the one implied by the selected mode.'
      );
    }

    const source = deeplSource(req.source);
    const target = deeplTarget(req.target);

    const result = await runChunks(
      req,
      ctx,
      async (items) => {
        const res = await this.transport({
          url: keyIsFree ? DEEPL_FREE_URL : DEEPL_PRO_URL,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'DeepL-Auth-Key ' + this.apiKey,
          },
          // DeepL sends no CORS headers, so this always goes via the sandbox.
          preferBridge: true,
          body: JSON.stringify({
            text: items.map((i) => markProtected(i.text, ctx.doNotTranslate, '<x>', '</x>')),
            source_lang: source,
            target_lang: target,
            tag_handling: 'xml',
            ignore_tags: ['x'],
            outline_detection: false,
            preserve_formatting: true,
          }),
          signal: ctx.signal,
        });
        if (!res.ok) {
          throw httpError(res, (status, detail) => {
            if (status === 403) return 'DeepL rejected the auth key (HTTP 403). ' + detail;
            if (status === 456) return 'DeepL character quota exhausted for this key (HTTP 456).';
            if (status === 429) return 'DeepL is rate limiting this key (HTTP 429). ' + detail;
            if (status === 413) return 'The batch was too large for DeepL (HTTP 413).';
            return null;
          });
        }
        const data = parseJson(res.body);
        const list = data && data.translations;
        if (!Array.isArray(list)) {
          throw new ResponseError('The DeepL response had no translations array.');
        }
        const out: Record<string, string> = {};
        for (let i = 0; i < items.length && i < list.length; i++) {
          const value = list[i] && list[i].text;
          if (typeof value === 'string' && value.length) {
            out[items[i].id] = unmarkProtected(value, 'x');
          }
        }
        return out;
      },
      this.apiKey,
      this.policy
    );

    for (const note of notes) result.issues.push(note);
    return result;
  }
}

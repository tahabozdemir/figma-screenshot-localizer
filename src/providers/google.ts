import { GOOGLE_POLICY, ResponseError, httpError, missingKey, runChunks } from './base';
import { googleCode } from '../shared/languages';
import { markProtected, unmarkProtected } from './protect';
import { parseJson, type Transport } from './transport';
import type { ProviderContext, TranslateRequest, TranslateResult, TranslationProvider } from './types';

export const GOOGLE_URL = 'https://translation.googleapis.com/language/translate/v2';

const OPEN = '<span translate="no">';
const CLOSE = '</span>';

/** Google Cloud Translation, with an API key whose project has the API enabled. */
export class GoogleTranslateProvider implements TranslationProvider {
  readonly id = 'google';
  readonly name = 'Google Translate';

  private readonly transport: Transport;
  private readonly apiKey: string;

  constructor(deps: { transport: Transport; apiKey: string }) {
    this.transport = deps.transport;
    this.apiKey = deps.apiKey;
  }

  async translate(req: TranslateRequest, ctx: ProviderContext): Promise<TranslateResult> {
    if (!this.apiKey) return missingKey('Google Cloud Translation');
    const source = googleCode(req.source);
    const target = googleCode(req.target);

    return runChunks(
      req,
      ctx,
      async (items) => {
        const res = await this.transport({
          url: GOOGLE_URL,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'x-goog-api-key': this.apiKey,
          },
          body: JSON.stringify({
            // HTML format is what makes `translate="no"` spans meaningful.
            q: items.map((i) => markProtected(i.text, ctx.doNotTranslate, OPEN, CLOSE)),
            source,
            target,
            format: 'html',
          }),
          signal: ctx.signal,
        });
        if (!res.ok) {
          throw httpError(res, (status, detail) => {
            if (status === 400 && /invalid/i.test(detail)) {
              return 'Google rejected the request (HTTP 400). ' + detail;
            }
            if (status === 403) {
              return (
                'Google refused the key (HTTP 403). Check that the key is valid and that the ' +
                'Cloud Translation API is enabled for its project. ' +
                detail
              );
            }
            return null;
          });
        }
        const data = parseJson(res.body);
        const list = data && data.data && data.data.translations;
        if (!Array.isArray(list)) {
          throw new ResponseError('The Google Translate response had no translations array.');
        }
        const out: Record<string, string> = {};
        for (let i = 0; i < items.length && i < list.length; i++) {
          const value = list[i] && list[i].translatedText;
          if (typeof value === 'string' && value.length) {
            out[items[i].id] = unmarkProtected(value, 'span');
          }
        }
        return out;
      },
      this.apiKey,
      GOOGLE_POLICY
    );
  }
}

import { GOOGLE_FREE_POLICY, ResponseError, httpError, runChunks } from './base';
import { googleCode } from '../shared/languages';
import { parseJson, type Transport } from './transport';
import type { ProviderContext, TranslateRequest, TranslateResult, TranslationProvider } from './types';

export const GOOGLE_FREE_URL = 'https://translate.googleapis.com/translate_a/single';

/** Longest string the endpoint reliably accepts, measured after encoding. */
const MAX_ENCODED = 1800;

/**
 * The endpoint the Google Translate web widget uses. No key, no cost, no
 * guarantees: it is undocumented, aggressively rate limited, accepts one string
 * per request and offers no way to mark text as untranslatable.
 */
export class GoogleFreeProvider implements TranslationProvider {
  readonly id = 'google-free';
  readonly name = 'Google Translate (free)';

  private readonly transport: Transport;

  constructor(deps: { transport: Transport }) {
    this.transport = deps.transport;
  }

  async translate(req: TranslateRequest, ctx: ProviderContext): Promise<TranslateResult> {
    const source = googleCode(req.source);
    const target = googleCode(req.target);

    return runChunks(
      req,
      ctx,
      async (items) => {
        const item = items[0];
        const encoded = encodeURIComponent(item.text);
        if (encoded.length > MAX_ENCODED) {
          throw new ResponseError(
            'String is too long for the free endpoint (' +
              item.text.length +
              ' characters). Use the Cloud API or DeepL for this one.'
          );
        }
        const res = await this.transport({
          url:
            GOOGLE_FREE_URL +
            '?client=gtx&sl=' +
            encodeURIComponent(source) +
            '&tl=' +
            encodeURIComponent(target) +
            '&dt=t&q=' +
            encoded,
          method: 'GET',
          headers: {},
          signal: ctx.signal,
        });
        if (!res.ok) {
          throw httpError(res, (status) =>
            status === 429
              ? 'The free Google endpoint is rate limiting this machine (HTTP 429). Wait a few minutes, or use a keyed provider.'
              : null
          );
        }
        const data = parseJson(res.body);
        const chunks = data && data[0];
        if (!Array.isArray(chunks)) {
          throw new ResponseError('The free Google endpoint returned an unexpected shape.');
        }
        let text = '';
        for (const part of chunks) {
          if (part && typeof part[0] === 'string') text += part[0];
        }
        const out: Record<string, string> = {};
        if (text) out[item.id] = text;
        return out;
      },
      '',
      GOOGLE_FREE_POLICY
    );
  }
}

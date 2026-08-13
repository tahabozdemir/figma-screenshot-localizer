import { LLM_POLICY, ResponseError, hasBudgets, httpError, missingKey, runChunks } from './base';
import { buildShortenPrompt, buildSystemPrompt, buildUserPayload, NUDGE, parseTranslations } from './prompt';
import { parseJson, type Transport } from './transport';
import type { ProviderContext, TranslateRequest, TranslateResult, TranslationProvider } from './types';

export const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
export const DEFAULT_GEMINI_MODEL = 'gemini-2.0-flash';

export class GeminiProvider implements TranslationProvider {
  readonly id = 'gemini';
  readonly name = 'Gemini';

  private readonly transport: Transport;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(deps: { transport: Transport; apiKey: string; model: string }) {
    this.transport = deps.transport;
    this.apiKey = deps.apiKey;
    this.model = deps.model || DEFAULT_GEMINI_MODEL;
  }

  translate(req: TranslateRequest, ctx: ProviderContext): Promise<TranslateResult> {
    if (!this.apiKey) return Promise.resolve(missingKey('Gemini'));
    return this.run(
      req,
      ctx,
      buildSystemPrompt(req.source, req.target, ctx.doNotTranslate, ctx.glossary, hasBudgets(req))
    );
  }

  shorten(req: TranslateRequest, ctx: ProviderContext): Promise<TranslateResult> {
    if (!this.apiKey) return Promise.resolve(missingKey('Gemini'));
    return this.run(req, ctx, buildShortenPrompt(req.target, ctx.doNotTranslate, ctx.glossary));
  }

  private run(req: TranslateRequest, ctx: ProviderContext, system: string): Promise<TranslateResult> {
    const url = GEMINI_BASE + encodeURIComponent(this.model) + ':generateContent';

    return runChunks(
      req,
      ctx,
      async (items, retryNudge) => {
        const res = await this.transport({
          url,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // Header, never the query string: URLs end up in logs and history.
            'x-goog-api-key': this.apiKey,
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [
              {
                role: 'user',
                parts: [{ text: buildUserPayload(req, items) + (retryNudge ? NUDGE : '') }],
              },
            ],
            generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
          }),
          signal: ctx.signal,
        });
        if (!res.ok) throw httpError(res);

        const data = parseJson(res.body);
        const candidate = data && data.candidates && data.candidates[0];
        const parts = candidate && candidate.content && candidate.content.parts;
        const text = Array.isArray(parts)
          ? parts.map((p: { text?: string }) => p.text || '').join('')
          : '';
        if (!text) {
          const reason =
            (data && data.promptFeedback && data.promptFeedback.blockReason) ||
            (candidate && candidate.finishReason);
          throw new ResponseError(
            'The Gemini response contained no text' + (reason ? ' (' + reason + ').' : '.')
          );
        }
        return parseTranslations(text, items);
      },
      this.apiKey,
      LLM_POLICY
    );
  }
}

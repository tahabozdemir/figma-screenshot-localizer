import { LLM_POLICY, ResponseError, hasBudgets, httpError, missingKey, runChunks } from './base';
import {
  buildShortenPrompt,
  buildSystemPrompt,
  buildUserPayload,
  NUDGE,
  parseTranslations,
} from './prompt';
import { parseJson, type Transport } from './transport';
import type {
  ChunkPolicy,
  ProviderContext,
  TranslateRequest,
  TranslateResult,
  TranslationProvider,
} from './types';

export const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
export const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';

/**
 * The reasoning families (o1/o3/o4…, gpt-5…) accept only the default
 * temperature and reject the parameter outright with a 400.
 */
export function modelRejectsTemperature(model: string): boolean {
  return /^(o\d|gpt-5)/i.test(model.trim());
}

export class OpenAIProvider implements TranslationProvider {
  readonly id = 'openai';
  readonly name = 'OpenAI';

  private readonly transport: Transport;
  private readonly policy: ChunkPolicy;
  private readonly apiKey: string;
  private readonly model: string;
  /** Set by `modelRejectsTemperature`, or by a 400 that names the field. */
  private omitTemperature: boolean;

  constructor(deps: { transport: Transport; apiKey: string; model: string; policy?: ChunkPolicy }) {
    this.transport = deps.transport;
    this.policy = deps.policy || LLM_POLICY;
    this.apiKey = deps.apiKey;
    this.model = deps.model || DEFAULT_OPENAI_MODEL;
    this.omitTemperature = modelRejectsTemperature(this.model);
  }

  translate(req: TranslateRequest, ctx: ProviderContext): Promise<TranslateResult> {
    if (!this.apiKey) return Promise.resolve(missingKey('OpenAI'));
    return this.run(
      req,
      ctx,
      buildSystemPrompt(req.source, req.target, ctx.doNotTranslate, ctx.glossary, hasBudgets(req))
    );
  }

  shorten(req: TranslateRequest, ctx: ProviderContext): Promise<TranslateResult> {
    if (!this.apiKey) return Promise.resolve(missingKey('OpenAI'));
    return this.run(req, ctx, buildShortenPrompt(req.target, ctx.doNotTranslate, ctx.glossary));
  }

  private run(
    req: TranslateRequest,
    ctx: ProviderContext,
    system: string
  ): Promise<TranslateResult> {
    return runChunks(
      req,
      ctx,
      async (items, retryNudge) => {
        const user = buildUserPayload(req, items) + (retryNudge ? NUDGE : '');
        const send = (omitTemperature: boolean) => {
          const payload: Record<string, unknown> = {
            model: this.model,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
          };
          if (!omitTemperature) payload.temperature = 0.2;
          return this.transport({
            url: OPENAI_URL,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer ' + this.apiKey,
            },
            body: JSON.stringify(payload),
            signal: ctx.signal,
          });
        };

        let res = await send(this.omitTemperature);
        if (
          !res.ok &&
          res.status === 400 &&
          !this.omitTemperature &&
          /temperature/i.test(res.body)
        ) {
          // The model id is newer than this list — remember it for the rest of the run.
          this.omitTemperature = true;
          res = await send(true);
        }
        if (!res.ok) throw httpError(res);

        const data = parseJson(res.body);
        const content =
          data && data.choices && data.choices[0] && data.choices[0].message
            ? data.choices[0].message.content
            : null;
        if (typeof content !== 'string' || !content.length) {
          throw new ResponseError('The OpenAI response contained no message content.');
        }
        return parseTranslations(content, items);
      },
      this.apiKey,
      this.policy
    );
  }
}

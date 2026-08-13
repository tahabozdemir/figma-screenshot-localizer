/**
 * Everything the LLM providers say and everything they are willing to hear
 * back. Kept away from transport and batching so a prompt change is a diff a
 * reviewer can actually read.
 */

import type { GlossaryEntry, LanguageDef, SourceString } from '../shared/types';
import type { TranslateRequest } from './types';

/** Thrown when a model returns something that is not usable JSON. */
export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}

/**
 * One term per line: `Streak = TR: Seri, DE: Serie`. Anything that does not
 * parse is skipped rather than rejected — the field is a scratchpad, and a
 * half-typed line must not break the run.
 */
export function parseGlossary(raw: string): GlossaryEntry[] {
  const out: GlossaryEntry[] = [];
  for (const line of (raw || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.charAt(0) === '#') continue;
    const split = trimmed.indexOf('=');
    if (split < 0) continue;
    const term = trimmed.slice(0, split).trim();
    if (!term) continue;

    const byLang: Record<string, string> = {};
    for (const part of trimmed.slice(split + 1).split(',')) {
      const colon = part.indexOf(':');
      if (colon < 0) continue;
      const code = part.slice(0, colon).trim().toUpperCase();
      const value = part.slice(colon + 1).trim();
      if (code && value) byLang[code] = value;
    }
    if (Object.keys(byLang).length) out.push({ term, byLang });
  }
  return out;
}

/** The glossary lines that apply to one target language, if any. */
export function glossaryFor(glossary: GlossaryEntry[] | undefined, target: LanguageDef): string[] {
  const out: string[] = [];
  for (const entry of glossary || []) {
    const value = entry.byLang[target.code];
    if (entry.term && value) out.push('"' + entry.term + '" -> "' + value + '"');
  }
  return out;
}

export function buildSystemPrompt(
  source: LanguageDef,
  target: LanguageDef,
  doNotTranslate: string[],
  glossary?: GlossaryEntry[],
  hasBudgets?: boolean
): string {
  const lines = [
    'You are a precise software localization engine for mobile App Store screenshot copy.',
    'Translate the given UI strings from ' +
      source.name +
      ' (' +
      source.tag +
      ') into ' +
      target.name +
      ' (' +
      target.tag +
      ').',
    '',
    'Hard rules:',
    '- Preserve meaning exactly. Do not summarize. Do not add information. Do not rewrite creatively.',
    '- Translate the values only. Never translate, alter, reorder or drop the ids.',
    '- Return a translation for every id you were given, and for no other id.',
    '- Preserve placeholders verbatim, including surrounding punctuation: {{name}}, {name}, {count}, %s, %d, %1$s, $VAR, and HTML-like tokens such as <b>…</b> or <0>…</0>.',
    '- Preserve all emoji, and keep them in the same position relative to the words.',
    '- Preserve leading/trailing whitespace and every line break (\\n) exactly as in the source.',
    '- Preserve the capitalization style (ALL CAPS stays ALL CAPS, Title Case stays Title Case) whenever that is natural in the target language.',
    '- Preserve numbers, units and currency symbols unless the target locale genuinely requires a different format.',
    '- These are short screenshot captions rendered in a fixed-width layout: prefer the shortest natural translation and avoid making the string noticeably longer than the source.',
  ];
  if (doNotTranslate.length) {
    lines.push(
      '- Never translate these product names / proper nouns, keep them exactly as written: ' +
        doNotTranslate.join(', ') +
        '.'
    );
  }
  const terms = glossaryFor(glossary, target);
  if (terms.length) {
    lines.push(
      '- Use these exact, pre-approved translations wherever the term appears, inflected to fit the sentence: ' +
        terms.join('; ') +
        '.'
    );
  }
  if (hasBudgets) {
    lines.push(
      '- Some strings carry "maxChars", measured from the actual box the text has to fit in. Treat it as a hard limit: if the natural translation is longer, rephrase it shorter — drop filler words, use a shorter synonym, split nothing. Never truncate mid-word and never append an ellipsis. Strings without "maxChars" are unconstrained.'
    );
  }
  if (target.rtl) {
    lines.push(
      '- The target language is right-to-left. Return plain logical-order text; do not insert directional control characters.'
    );
  }
  lines.push(
    '',
    'Output format:',
    'Return STRICT JSON and nothing else. No markdown, no code fences, no commentary.',
    'Shape: {"translations": {"<id>": "<translated text>"}}'
  );
  return lines.join('\n');
}

export function buildUserPayload(req: TranslateRequest, items: SourceString[]): string {
  const budgets = req.budgets || {};
  return JSON.stringify({
    sourceLanguage: req.source.tag,
    targetLanguage: req.target.tag,
    strings: items.map((s) => {
      const max = budgets[s.id];
      return typeof max === 'number' && max > 0
        ? { id: s.id, text: s.text, maxChars: max }
        : { id: s.id, text: s.text };
    }),
  });
}

/**
 * Prompt for the fit pass: the text is already in the target language but
 * overflowed its box, so we ask for a shorter rendition rather than a retry.
 */
export function buildShortenPrompt(
  target: LanguageDef,
  doNotTranslate: string[],
  glossary?: GlossaryEntry[]
): string {
  const lines = [
    'You are an expert ' +
      target.name +
      ' UI copywriter tightening App Store screenshot captions that do not fit their layout.',
    '',
    'Hard rules:',
    '- The text is ALREADY in ' +
      target.name +
      ' (' +
      target.tag +
      '). Do not translate it into another language.',
    '- Return a shorter version of each string that keeps the same meaning and tone.',
    '- Respect "maxChars" for every string. That is a hard limit, not a target.',
    '- Never truncate mid-word, never append "…", never drop a whole clause that carries meaning.',
    '- Keep placeholders ({{name}}, {count}, %s, %1$s, <b>…</b>), emoji and line breaks exactly as they are.',
    '- Keep the capitalization style of the original.',
    '- If a string is already within its budget, return it unchanged.',
  ];
  if (doNotTranslate.length) {
    lines.push('- Keep these names exactly as written: ' + doNotTranslate.join(', ') + '.');
  }
  const terms = glossaryFor(glossary, target);
  if (terms.length) {
    lines.push(
      '- Keep these approved terms: ' + terms.map((t) => t.split(' -> ')[1]).join(', ') + '.'
    );
  }
  lines.push(
    '',
    'Output format:',
    'Return STRICT JSON and nothing else. No markdown, no code fences, no commentary.',
    'Shape: {"translations": {"<id>": "<shorter text>"}}'
  );
  return lines.join('\n');
}

export const NUDGE =
  '\n\nYour previous answer was not valid JSON. Reply with strict JSON only, exactly: {"translations":{"id":"text"}}';

/** Tolerant JSON extraction — models occasionally wrap output in fences. */
export function parseTranslations(raw: string, expected: SourceString[]): Record<string, string> {
  let text = (raw || '').trim();
  if (text.indexOf('```') >= 0) text = text.replace(/```(?:json)?/gi, '').trim();
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first > 0 || last < text.length - 1) {
    if (first >= 0 && last > first) text = text.slice(first, last + 1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new ParseError('The model returned malformed JSON.');
  }

  const root = parsed as Record<string, unknown>;
  const bag =
    root && typeof root === 'object' && root.translations && typeof root.translations === 'object'
      ? (root.translations as Record<string, unknown>)
      : root;

  const wanted: Record<string, true> = {};
  for (const s of expected) wanted[s.id] = true;

  const out: Record<string, string> = {};
  for (const key of Object.keys(bag || {})) {
    if (!wanted[key]) continue;
    const value = bag[key];
    if (typeof value === 'string' && value.length) out[key] = value;
  }
  return out;
}

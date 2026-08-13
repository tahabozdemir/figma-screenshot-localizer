/**
 * Placeholder and proper-noun protection, plus the check that the engine
 * actually honoured it.
 *
 * Machine translation will happily "translate" `{{name}}` into `{{ Name }}` and
 * turn a product name into a common noun. Protected spans are wrapped in the
 * engine's own do-not-translate element before sending, unwrapped afterwards,
 * and whatever survives is verified.
 */

import { escapeMarkup } from '../shared/html';
import type { SourceString } from '../shared/types';

export const PLACEHOLDER_RE =
  /(\{\{[^{}]*\}\}|\{[^{}]*\}|%\d*\$?[sdfx@]|<\/?[A-Za-z][\w-]*[^>]*>|\[\[[^\]]*\]\])/g;

export interface Range {
  start: number;
  end: number;
}

/** Character ranges that a translation engine must copy through verbatim. */
export function protectedRanges(text: string, terms: string[]): Range[] {
  const ranges: Range[] = [];
  PLACEHOLDER_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PLACEHOLDER_RE.exec(text)) !== null) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
    if (match.index === PLACEHOLDER_RE.lastIndex) PLACEHOLDER_RE.lastIndex++;
  }
  for (const term of terms) {
    if (!term) continue;
    let from = 0;
    for (;;) {
      const at = text.indexOf(term, from);
      if (at < 0) break;
      ranges.push({ start: at, end: at + term.length });
      from = at + term.length;
    }
  }
  ranges.sort((a, b) => a.start - b.start || b.end - a.end);

  const merged: Range[] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ start: range.start, end: range.end });
  }
  return merged;
}

/** Wraps every protected span in the engine's "do not translate" element. */
export function markProtected(text: string, terms: string[], open: string, close: string): string {
  const ranges = protectedRanges(text, terms);
  if (!ranges.length) return escapeMarkup(text);
  let out = '';
  let cursor = 0;
  for (const range of ranges) {
    out += escapeMarkup(text.slice(cursor, range.start));
    out += open + escapeMarkup(text.slice(range.start, range.end)) + close;
    cursor = range.end;
  }
  return out + escapeMarkup(text.slice(cursor));
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#\d+|#[xX][0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.charAt(0) === '#') {
      const code =
        body.charAt(1) === 'x' || body.charAt(1) === 'X'
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      // fromCodePoint, not fromCharCode: emoji live above 0xFFFF and would
      // otherwise be silently truncated into a different character.
      if (isNaN(code) || code < 0 || code > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch (e) {
        return whole;
      }
    }
    const mapped = ENTITIES[body.toLowerCase()];
    return mapped === undefined ? whole : mapped;
  });
}

/** Removes the protection element again, then unescapes the payload. */
export function unmarkProtected(text: string, tagName: string): string {
  const stripped = text.replace(new RegExp('</?' + tagName + '(\\s[^>]*)?>', 'gi'), '');
  return decodeEntities(stripped);
}

/* ------------------------------------------------------------------ */
/* Output verification                                                 */
/* ------------------------------------------------------------------ */

function preview(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 42 ? flat.slice(0, 42) + '…' : flat;
}

/** Reports placeholders and protected nouns that did not survive translation. */
export function qualityIssues(
  items: SourceString[],
  out: Record<string, string>,
  doNotTranslate: string[]
): string[] {
  const issues: string[] = [];
  for (const item of items) {
    const translated = out[item.id];
    if (typeof translated !== 'string') continue;

    PLACEHOLDER_RE.lastIndex = 0;
    const expected = item.text.match(PLACEHOLDER_RE) || [];
    const missing: string[] = [];
    for (const token of expected) {
      if (translated.indexOf(token) < 0 && missing.indexOf(token) < 0) missing.push(token);
    }
    for (const term of doNotTranslate) {
      if (!term) continue;
      if (item.text.indexOf(term) >= 0 && translated.indexOf(term) < 0 && missing.indexOf(term) < 0) {
        missing.push(term);
      }
    }
    if (missing.length) {
      issues.push(missing.join(', ') + ' did not survive the translation of "' + preview(item.text) + '".');
    }
  }
  return issues;
}

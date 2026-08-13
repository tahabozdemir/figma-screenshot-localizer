/**
 * Warnings are raised as structured facts, not as English sentences.
 *
 * The sandbox knows *what* went wrong; only the UI turns that into prose. This
 * buys three things the old string-concatenation approach could not:
 *   - tests assert on `code`, so rewording a message never breaks a test
 *   - the list can be grouped, filtered and counted by kind
 *   - the panel's own wording is translatable, which a localization tool that
 *     only speaks English has no business not being
 */

import type { Severity } from './types';

export type WarningCode = WarningDetail['code'];

export type WarningDetail =
  /** The provider returned nothing for this string. */
  | { code: 'no-translation' }
  /** Two different source strings hashed to the same id — never write that. */
  | { code: 'hash-collision' }
  | { code: 'font-unavailable'; font?: string }
  | { code: 'text-write-failed' }
  | { code: 'style-remapped' }
  | { code: 'rtl-mirrored'; language: string }
  | { code: 'script-coverage'; font: string; script: string }
  | {
      code: 'overflow';
      overflowH: number;
      overflowW: number;
      /** Length change against the source, as a ratio (0.2 = 20% longer). */
      growth: number;
      autoAdjust: boolean;
      fontScale: number;
      /** A shorter rewrite was applied and it still did not fit. */
      shortened: boolean;
    }
  | { code: 'font-scaled'; fontScale: number; letterSpacingDelta: number }
  | { code: 'tight-fit'; growth: number }
  | { code: 'shortened'; text: string }
  | { code: 'shorten-failed'; reason: string }
  | { code: 'fit-pass-failed'; reason: string }
  | { code: 'frame-clone-failed'; reason: string }
  | { code: 'frame-replaced' }
  | { code: 'frame-partial'; reason: string }
  | { code: 'language-skipped'; reason: string }
  | { code: 'partial-translation'; added: number; total: number; reason: string }
  | { code: 'strings-empty'; count: number }
  | { code: 'provider-issue'; detail: string };

export interface Warning {
  detail: WarningDetail;
  /** Frame name, or NONE when the warning is about the language as a whole. */
  frame: string;
  language: string;
  layer: string;
  severity: Severity;
  /** Node id of the offending layer so the UI can select it. */
  nodeId?: string;
}

/** Placeholder for the frame/layer columns when a warning is not layer-specific. */
export const NONE = '—';

function percent(ratio: number): string {
  return Math.round(ratio * 100) + '%';
}

function overflowText(d: Extract<WarningDetail, { code: 'overflow' }>): string {
  const parts: string[] = [];
  if (d.overflowH > 0.75) parts.push('exceeded the available height by ' + Math.ceil(d.overflowH) + 'px');
  if (d.overflowW > 0.75) parts.push('exceeded the available width by ' + Math.ceil(d.overflowW) + 'px');
  const detail = parts.length ? parts.join(' and ') : 'does not fit its container';
  const lengthNote =
    d.growth > 0.05 ? ' Translation is ' + percent(d.growth) + ' longer than the source.' : '';
  const adjustNote = d.autoAdjust
    ? ' Auto-adjust hit its safe limit (font ' + percent(d.fontScale) + ').'
    : ' Auto-adjust is off.';
  const shortNote = d.shortened ? ' A shorter rewrite was applied and still did not fit.' : '';
  return 'Text box ' + detail + '.' + lengthNote + adjustNote + shortNote;
}

/** The single place a warning becomes a sentence. */
export function formatWarning(detail: WarningDetail): string {
  switch (detail.code) {
    case 'no-translation':
      return 'No translation available — source text kept.';

    case 'hash-collision':
      return 'Two different source strings produced the same internal id, so this layer was left alone rather than risk writing the wrong translation. Please report this.';

    case 'font-unavailable':
      return (
        (detail.font ? '"' + detail.font + '"' : 'The layer font') +
        ' is not available in this file — layer skipped.'
      );

    case 'text-write-failed':
      return 'Text could not be written (locked layer, or an instance override Figma does not allow).';

    case 'style-remapped':
      return 'Layer had mixed character styling; styles were re-applied proportionally — please eyeball it.';

    case 'rtl-mirrored':
      return (
        detail.language +
        ' is right-to-left. Text alignment was mirrored, but icon/element order was left untouched — review manually.'
      );

    case 'script-coverage':
      return (
        'Verify that "' +
        detail.font +
        '" contains ' +
        detail.script +
        ' glyphs — Figma silently substitutes a fallback font otherwise.'
      );

    case 'overflow':
      return overflowText(detail);

    case 'font-scaled':
      return (
        'Font size reduced to ' +
        percent(detail.fontScale) +
        ' to fit the translation' +
        (detail.letterSpacingDelta
          ? ' (letter spacing tightened by ' + detail.letterSpacingDelta + '%)'
          : '') +
        '.'
      );

    case 'tight-fit':
      return (
        'Translation is ' +
        percent(detail.growth) +
        ' longer than the source and now fills its box — visually double-check this layer.'
      );

    case 'shortened':
      return (
        'Translation overflowed, so the model was asked for a shorter wording: “' +
        detail.text +
        '”. Check that it still reads well.'
      );

    case 'shorten-failed':
      return 'Could not shorten the overflowing strings: ' + detail.reason;

    case 'fit-pass-failed':
      return 'The fit pass failed — ' + detail.reason;

    case 'frame-clone-failed':
      return 'Frame could not be duplicated: ' + detail.reason;

    case 'frame-replaced':
      return 'Replaced the existing frame of the same name from an earlier run.';

    case 'frame-partial':
      return 'Frame partially localized — ' + detail.reason;

    case 'language-skipped':
      return 'Language skipped: ' + detail.reason;

    case 'partial-translation':
      return (
        'Partial translation (' + detail.added + '/' + detail.total + '): ' + detail.reason
      );

    case 'strings-empty':
      return detail.count + ' string(s) came back empty and kept their source text.';

    case 'provider-issue':
      return detail.detail;

    default:
      // A build mismatch between the two threads, or a code added without a
      // message. Show something rather than an empty row.
      return 'Unrecognized warning (' + String((detail as { code: string }).code) + ').';
  }
}

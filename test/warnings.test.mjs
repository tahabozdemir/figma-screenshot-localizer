/**
 * Warnings are structured facts formatted in one place. These tests guard the
 * property that matters: every code the pipeline can raise produces a sentence,
 * and an unknown code degrades instead of rendering blank.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatWarning } from '../dist-test/lib.mjs';

/** One sample per code. Adding a code without a message fails the sweep below. */
const SAMPLES = [
  { code: 'no-translation' },
  { code: 'hash-collision' },
  { code: 'font-unavailable', font: 'Inter Bold' },
  { code: 'font-unavailable' },
  { code: 'text-write-failed' },
  { code: 'style-remapped' },
  { code: 'rtl-mirrored', language: 'Arabic' },
  { code: 'script-coverage', font: 'Inter', script: 'CJK' },
  {
    code: 'overflow',
    overflowH: 20.4,
    overflowW: 0,
    growth: 0.92,
    autoAdjust: true,
    fontScale: 0.86,
    shortened: false,
  },
  { code: 'font-scaled', fontScale: 0.9, letterSpacingDelta: -1 },
  { code: 'tight-fit', growth: 0.31 },
  { code: 'shortened', text: 'Kürzer' },
  { code: 'shorten-failed', reason: 'HTTP 429' },
  { code: 'fit-pass-failed', reason: 'boom' },
  { code: 'frame-clone-failed', reason: 'locked' },
  { code: 'frame-replaced' },
  { code: 'frame-partial', reason: 'boom' },
  { code: 'language-skipped', reason: 'Invalid API key (HTTP 401).' },
  { code: 'partial-translation', added: 3, total: 10, reason: 'Batch 2 failed.' },
  { code: 'strings-empty', count: 4 },
  { code: 'provider-issue', detail: '{{name}} did not survive.' },
];

test('every warning code renders a non-empty sentence', () => {
  for (const detail of SAMPLES) {
    const message = formatWarning(detail);
    assert.ok(message && message.length > 5, 'empty message for ' + detail.code);
    assert.ok(
      message.indexOf('undefined') < 0,
      detail.code + ' rendered an undefined parameter: ' + message
    );
    assert.ok(message.indexOf('Unrecognized') < 0, detail.code + ' fell through to the default');
  }
});

test('the overflow message states the direction, the growth and the limit', () => {
  const message = formatWarning({
    code: 'overflow',
    overflowH: 20.4,
    overflowW: 0,
    growth: 0.92,
    autoAdjust: true,
    fontScale: 0.86,
    shortened: false,
  });
  assert.match(message, /height by 21px/);
  assert.match(message, /92% longer/);
  assert.match(message, /font 86%/);
  assert.ok(message.indexOf('width') < 0, 'a width that fits must not be mentioned');
});

test('overflow in both directions mentions both', () => {
  const message = formatWarning({
    code: 'overflow',
    overflowH: 5,
    overflowW: 8,
    growth: 0,
    autoAdjust: false,
    fontScale: 1,
    shortened: true,
  });
  assert.match(message, /height by 5px and .*width by 8px/);
  assert.match(message, /Auto-adjust is off/);
  assert.match(message, /shorter rewrite was applied/);
  assert.ok(message.indexOf('longer than the source') < 0, 'no growth, no growth note');
});

test('a named font is quoted, an unknown one is described', () => {
  assert.match(formatWarning({ code: 'font-unavailable', font: 'Inter Bold' }), /"Inter Bold"/);
  assert.match(formatWarning({ code: 'font-unavailable' }), /The layer font/);
});

test('an unknown code from a mismatched build still renders a row', () => {
  const message = formatWarning({ code: 'something-from-the-future' });
  assert.match(message, /Unrecognized warning/);
  assert.match(message, /something-from-the-future/);
});

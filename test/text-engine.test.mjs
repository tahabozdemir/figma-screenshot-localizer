/**
 * Measurement tests. Figma nodes are faked: the only behaviour these functions
 * rely on is that flipping `textAutoResize` to HEIGHT makes width/height report
 * the size the text *wants*, which a plain object can model exactly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// text-engine never touches `figma` at import time, but sampleSizes would if a
// test ever reached it. Stub it so a mistake fails loudly instead of crashing.
globalThis.figma = { mixed: Symbol('figma.mixed') };

const { capacityChars, autoFit, MIN_FONT_SCALE } = await import('../dist-test/lib.mjs');

/**
 * `box` is the frame the designer drew, `natural` is what the text wants.
 * For auto-resizing modes the two are the same thing, which is exactly how
 * Figma behaves.
 */
function fakeText({ text, mode, box = [100, 50], natural = [100, 50] }) {
  const node = {
    characters: text,
    textAutoResize: mode,
    _boxW: box[0],
    _boxH: box[1],
    resize(w, h) {
      node._boxW = w;
      node._boxH = h;
    },
  };
  const fixed = () => node.textAutoResize === 'NONE' || node.textAutoResize === 'TRUNCATE';
  Object.defineProperty(node, 'width', { get: () => (fixed() ? node._boxW : natural[0]) });
  Object.defineProperty(node, 'height', { get: () => (fixed() ? node._boxH : natural[1]) });
  return node;
}

/* ------------------------------------------------------------------ */
/* capacityChars                                                       */
/* ------------------------------------------------------------------ */

test('an auto-height layer scales its budget with the room below it', () => {
  const node = fakeText({ text: 'x'.repeat(20), mode: 'HEIGHT', natural: [200, 40] });
  // Three times the height it currently uses.
  assert.equal(capacityChars(node, { w: 200, h: 120 }), 60);
});

test('a layer that exactly fills its space gets its own length as the budget', () => {
  const node = fakeText({ text: 'x'.repeat(31), mode: 'HEIGHT', natural: [200, 40] });
  assert.equal(capacityChars(node, { w: 200, h: 40 }), 31);
});

test('an auto-width layer is measured sideways, not downwards', () => {
  const node = fakeText({ text: 'Start now', mode: 'WIDTH_AND_HEIGHT', natural: [100, 20] });
  // Twice the width, but no extra height — the budget must follow the width.
  assert.equal(capacityChars(node, { w: 200, h: 20 }), 18);
});

test('a fixed box is capped by the box itself, not by the room around it', () => {
  const node = fakeText({
    text: 'x'.repeat(10),
    mode: 'NONE',
    box: [200, 60],
    natural: [200, 30],
  });
  // The parent has 400px going spare, but the text box will never grow.
  assert.equal(capacityChars(node, { w: 200, h: 400 }), 20);
});

test('an unconstrained layer has nothing useful to say', () => {
  const node = fakeText({ text: 'Hello', mode: 'HEIGHT', natural: [200, 40] });
  assert.equal(capacityChars(node, { w: Infinity, h: Infinity }), null);
});

test('an empty layer has no budget', () => {
  const node = fakeText({ text: '', mode: 'HEIGHT', natural: [200, 40] });
  assert.equal(capacityChars(node, { w: 200, h: 400 }), null);
});

test('the budget never collapses to nothing', () => {
  const node = fakeText({ text: 'x'.repeat(4), mode: 'HEIGHT', natural: [200, 400] });
  assert.equal(capacityChars(node, { w: 200, h: 1 }), 6);
});

test('measuring a fixed box leaves the node exactly as it was found', () => {
  const node = fakeText({ text: 'x'.repeat(10), mode: 'NONE', box: [200, 60], natural: [200, 30] });
  capacityChars(node, { w: 200, h: 60 });
  assert.equal(node.textAutoResize, 'NONE');
  assert.equal(node.width, 200);
  assert.equal(node.height, 60);
});

/* ------------------------------------------------------------------ */
/* autoFit — measurement only (adjustment needs the real range API)    */
/* ------------------------------------------------------------------ */

test('autoFit leaves a layer that already fits alone', () => {
  const node = fakeText({ text: 'Short', mode: 'NONE', box: [100, 50], natural: [100, 40] });
  const fit = autoFit(node, { w: 100, h: 50 }, false, false);
  assert.equal(fit.fits, true);
  assert.equal(fit.fontScale, 1);
  assert.equal(fit.overflowH, 0);
});

test('autoFit reports how far past the box the text goes', () => {
  const node = fakeText({ text: 'Much longer', mode: 'NONE', box: [100, 50], natural: [100, 70] });
  const fit = autoFit(node, { w: 100, h: 50 }, false, false);
  assert.equal(fit.fits, false);
  assert.equal(fit.overflowH, 20);
  // With adjustment off, nothing was tried.
  assert.equal(fit.fontScale, 1);
});

test('autoFit measures an auto-height layer against the room it has', () => {
  const node = fakeText({ text: 'Wraps', mode: 'HEIGHT', natural: [200, 90] });
  assert.equal(autoFit(node, { w: 200, h: 120 }, false, false).fits, true);
  assert.equal(autoFit(node, { w: 200, h: 60 }, false, false).fits, false);
});

test('the shrink guard rail is where the README says it is', () => {
  assert.equal(MIN_FONT_SCALE, 0.85);
});

/**
 * Message validation. The sandbox mutates a document off these payloads, so
 * "the other side is our own code" is not a strong enough assumption: Figma
 * keeps an old iframe alive across a rebuild, and `window.onmessage` in a
 * browser context delivers whatever it is given.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseUiToPlugin, parsePluginToUi } from '../dist-test/lib.mjs';

const validConfig = {
  sourceLanguage: 'EN',
  targets: ['DE'],
  mode: 'openai',
  options: {},
  doNotTranslate: ['HabitFlow'],
  cacheKey: 'openai/gpt-4o-mini',
  capabilities: { shorten: true, budgets: true },
};

test('junk is dropped rather than half-parsed', () => {
  for (const junk of [null, undefined, 0, 'hello', [], {}, { type: 42 }, { type: 'nope' }]) {
    assert.equal(parseUiToPlugin(junk), null, JSON.stringify(junk));
    assert.equal(parsePluginToUi(junk), null, JSON.stringify(junk));
  }
});

test('a generate config is filled in and sanitized', () => {
  const msg = parseUiToPlugin({ type: 'generate', config: validConfig });
  assert.equal(msg.type, 'generate');
  assert.equal(msg.config.options.autoAdjust, true, 'missing options fall back to the defaults');
  assert.deepEqual(msg.config.capabilities, { shorten: true, budgets: true });
  assert.deepEqual(msg.config.doNotTranslate, ['HabitFlow']);
});

test('a generate with no usable target is refused outright', () => {
  assert.equal(parseUiToPlugin({ type: 'generate', config: { ...validConfig, targets: [] } }), null);
  assert.equal(parseUiToPlugin({ type: 'generate', config: { ...validConfig, targets: 'DE' } }), null);
  assert.equal(parseUiToPlugin({ type: 'generate' }), null);
});

test('capabilities cannot be smuggled in as truthy junk', () => {
  const msg = parseUiToPlugin({
    type: 'generate',
    config: { ...validConfig, capabilities: { shorten: 'yes', budgets: 1 } },
  });
  assert.deepEqual(msg.config.capabilities, { shorten: false, budgets: false });
});

test('an empty cache bucket becomes null rather than an empty storage key', () => {
  const msg = parseUiToPlugin({ type: 'generate', config: { ...validConfig, cacheKey: '' } });
  assert.equal(msg.config.cacheKey, null);
});

test('translation replies keep only string values', () => {
  const msg = parseUiToPlugin({
    type: 'translations',
    requestId: 'req1',
    translations: { a: 'Eins', b: 42, c: null, d: { nested: true } },
    issues: ['one', 2],
  });
  assert.deepEqual(msg.translations, { a: 'Eins' });
  assert.deepEqual(msg.issues, ['one']);
});

test('a reply with no request id is dropped', () => {
  assert.equal(parseUiToPlugin({ type: 'translations', translations: {} }), null);
});

test('settings and secrets are normalized on the way in', () => {
  const msg = parseUiToPlugin({
    type: 'save-settings',
    settings: { mode: 'made-up', targets: ['DE', 7], openaiKey: 'sk-should-be-ignored' },
  });
  assert.equal(msg.settings.mode, 'manual');
  assert.deepEqual(msg.settings.targets, ['DE']);
  assert.equal(msg.settings.openaiKey, undefined);

  const secrets = parseUiToPlugin({ type: 'save-secrets', secrets: { openaiKey: 'sk-x', bogus: 1 } });
  assert.equal(secrets.secrets.openaiKey, 'sk-x');
  assert.equal(secrets.secrets.bogus, undefined);
});

test('an http-request needs a url and an id, and only knows two methods', () => {
  assert.equal(parseUiToPlugin({ type: 'http-request', requestId: 'a' }), null);
  const msg = parseUiToPlugin({
    type: 'http-request',
    requestId: 'a',
    url: 'https://example.com',
    method: 'DELETE',
    headers: { A: 'b', C: 3 },
  });
  assert.equal(msg.method, 'GET', 'an unknown verb must not be forwarded');
  assert.deepEqual(msg.headers, { A: 'b' });
});

test('select-nodes drops non-string ids', () => {
  assert.deepEqual(parseUiToPlugin({ type: 'select-nodes', ids: ['a', 1, null] }).ids, ['a']);
});

test('resize coerces to finite numbers', () => {
  const msg = parseUiToPlugin({ type: 'resize', width: 'wide', height: Infinity });
  assert.equal(msg.width, 0);
  assert.equal(msg.height, 0);
});

test('a translate-request without both languages is dropped', () => {
  const base = {
    type: 'translate-request',
    requestId: 'r1',
    source: { code: 'EN', tag: 'en', name: 'English' },
    target: { code: 'DE', tag: 'de', name: 'German' },
    strings: [{ id: 'a', text: 'One' }, { id: 'b' }, 'nope'],
  };
  assert.equal(parsePluginToUi({ ...base, target: undefined }), null);
  const msg = parsePluginToUi(base);
  assert.deepEqual(msg.strings, [{ id: 'a', text: 'One', count: 1 }]);
  assert.equal(msg.source.rtl, false);
  assert.equal(msg.shorten, false);
});

test('budgets keep only finite numbers', () => {
  const msg = parsePluginToUi({
    type: 'translate-request',
    requestId: 'r1',
    source: { code: 'EN', tag: 'en' },
    target: { code: 'DE', tag: 'de' },
    strings: [],
    budgets: { a: 24, b: 'wide', c: NaN },
  });
  assert.deepEqual(msg.budgets, { a: 24 });
});

test('a summary is filled in so the panel cannot render "undefined"', () => {
  const msg = parsePluginToUi({ type: 'done', summary: { framesCreated: 3 }, warnings: 'nope' });
  assert.equal(msg.summary.framesCreated, 3);
  assert.equal(msg.summary.cacheHits, 0);
  assert.equal(msg.summary.warnings, 0);
  for (const value of Object.values(msg.summary)) assert.equal(typeof value, 'number');
  assert.deepEqual(msg.warnings, []);
});

test('an http-response defaults to retryable unless it says otherwise', () => {
  assert.equal(parsePluginToUi({ type: 'http-response', requestId: 'h1' }).retryable, true);
  assert.equal(
    parsePluginToUi({ type: 'http-response', requestId: 'h1', retryable: false }).retryable,
    false
  );
});

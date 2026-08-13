/**
 * Storage, driven by an in-memory port. Covers the v1 -> v2 migration, which is
 * the part that can quietly lose someone's API keys.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  Storage,
  splitLegacySettings,
  capEntries,
  capManual,
  tmKey,
  SETTINGS_KEY,
  LEGACY_SETTINGS_KEY,
  SECRETS_KEY,
  TM_PREFIX,
} from '../dist-test/lib.mjs';

function memoryPort(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    get: async (key) => (map.has(key) ? map.get(key) : undefined),
    set: async (key, value) => void map.set(key, value),
    remove: async (key) => void map.delete(key),
    keys: async () => Array.from(map.keys()),
  };
}

/** A port whose writes always fail, like a clientStorage over quota. */
function brokenPort() {
  return {
    get: async () => {
      throw new Error('unavailable');
    },
    set: async () => {
      throw new Error('over quota');
    },
    remove: async () => {
      throw new Error('nope');
    },
    keys: async () => {
      throw new Error('nope');
    },
  };
}

/* ------------------------------------------------------------------ */
/* Migration                                                           */
/* ------------------------------------------------------------------ */

test('splitLegacySettings separates the keys from the settings', () => {
  const { settings, secrets } = splitLegacySettings({
    sourceLanguage: 'TR',
    mode: 'openai',
    openaiKey: 'sk-legacy',
    openaiModel: 'gpt-4o',
    deeplKey: 'dl-legacy',
  });
  assert.equal(settings.sourceLanguage, 'TR');
  assert.equal(settings.openaiModel, 'gpt-4o');
  assert.equal(secrets.openaiKey, 'sk-legacy');
  assert.equal(secrets.deeplKey, 'dl-legacy');
  assert.equal(settings.openaiKey, undefined, 'a key must not survive in the settings blob');
});

test('a v1 install is migrated on first load and the old blob is removed', async () => {
  const port = memoryPort({
    [LEGACY_SETTINGS_KEY]: { mode: 'deepl', targets: ['DE'], deeplKey: 'dl-1', geminiModel: 'x' },
  });
  const storage = new Storage(port);

  const state = await storage.loadAll();

  assert.equal(state.settings.mode, 'deepl');
  assert.deepEqual(state.settings.targets, ['DE']);
  assert.equal(state.secrets.deeplKey, 'dl-1');
  assert.ok(port.map.has(SETTINGS_KEY));
  assert.ok(port.map.has(SECRETS_KEY));
  assert.equal(port.map.has(LEGACY_SETTINGS_KEY), false, 'the old blob still holds the plaintext keys');
  assert.equal(port.map.get(SETTINGS_KEY).deeplKey, undefined);
});

test('migration does not run again once v2 exists', async () => {
  const port = memoryPort({
    [SETTINGS_KEY]: { mode: 'openai' },
    [SECRETS_KEY]: { openaiKey: 'sk-new' },
    [LEGACY_SETTINGS_KEY]: { mode: 'manual', openaiKey: 'sk-old' },
  });

  const state = await new Storage(port).loadAll();

  assert.equal(state.settings.mode, 'openai');
  assert.equal(state.secrets.openaiKey, 'sk-new');
  assert.ok(port.map.has(LEGACY_SETTINGS_KEY), 'nothing should be deleted when there is no migration');
});

test('a fresh install loads defaults without writing anything', async () => {
  const port = memoryPort();
  const state = await new Storage(port).loadAll();
  assert.equal(state.settings.mode, 'manual');
  assert.deepEqual(state.manual, {});
  assert.equal(port.map.size, 0);
});

test('garbage in storage is normalized rather than trusted', async () => {
  const port = memoryPort({
    [SETTINGS_KEY]: { mode: 'not-a-provider', targets: ['DE', 42, null], options: 'nope', debug: 'yes' },
    [SECRETS_KEY]: { openaiKey: 12345 },
  });

  const state = await new Storage(port).loadAll();

  assert.equal(state.settings.mode, 'manual');
  assert.deepEqual(state.settings.targets, ['DE']);
  assert.equal(state.settings.options.autoAdjust, true);
  assert.equal(state.settings.debug, false);
  assert.equal(state.secrets.openaiKey, '');
});

test('a storage that cannot be written does not break the load', async () => {
  const state = await new Storage(brokenPort()).loadAll();
  assert.equal(state.settings.mode, 'manual');
  await state; // no throw
  await new Storage(brokenPort()).saveSettings(state.settings);
  assert.equal(await new Storage(brokenPort()).clearCache(), 0);
});

/* ------------------------------------------------------------------ */
/* Translation memory                                                  */
/* ------------------------------------------------------------------ */

test('the translation memory round-trips per language pair', async () => {
  const port = memoryPort();
  const storage = new Storage(port);

  await storage.saveTM('openai/gpt-4o-mini', 'en', 'de', { One: 'Eins' });

  assert.deepEqual(await storage.loadTM('openai/gpt-4o-mini', 'en', 'de'), { One: 'Eins' });
  assert.deepEqual(await storage.loadTM('openai/gpt-4o-mini', 'en', 'fr'), {}, 'wrong target');
  assert.deepEqual(await storage.loadTM('deepl', 'en', 'de'), {}, 'wrong engine');
  assert.deepEqual(await storage.loadTM('openai/gpt-5', 'en', 'de'), {}, 'wrong model');
});

test('a null bucket never reads or writes', async () => {
  const port = memoryPort();
  const storage = new Storage(port);
  await storage.saveTM(null, 'en', 'de', { One: 'Eins' });
  assert.equal(port.map.size, 0);
  assert.deepEqual(await storage.loadTM(null, 'en', 'de'), {});
});

test('clearCache removes every bucket and nothing else', async () => {
  const port = memoryPort({
    [tmKey('deepl', 'en', 'de')]: { a: 'b' },
    [tmKey('openai/gpt-4o-mini', 'en', 'fr')]: { a: 'b' },
    [SETTINGS_KEY]: { mode: 'manual' },
  });

  const removed = await new Storage(port).clearCache();

  assert.equal(removed, 2);
  assert.deepEqual(Array.from(port.map.keys()), [SETTINGS_KEY]);
  assert.ok(tmKey('deepl', 'en', 'de').startsWith(TM_PREFIX));
});

/* ------------------------------------------------------------------ */
/* Quota caps                                                          */
/* ------------------------------------------------------------------ */

test('capEntries keeps the newest entries', () => {
  const entries = {};
  for (let i = 0; i < 10; i++) entries['k' + i] = 'v' + i;
  const capped = capEntries(entries, 3);
  assert.deepEqual(Object.keys(capped), ['k7', 'k8', 'k9']);
  assert.equal(capEntries({ a: '1' }, 3).a, '1');
});

test('capManual drops blanks so quota goes on real translations', () => {
  const capped = capManual({ DE: { a: 'Eins', b: '', c: '   ' }, FR: {} }, 100);
  assert.deepEqual(capped.table, { DE: { a: 'Eins' } });
  assert.equal(capped.dropped, 0, 'a blank was never work');
});

test('capManual stops at the budget and counts what it had to leave behind', () => {
  const bag = {};
  for (let i = 0; i < 10; i++) bag['id' + i] = 'value';
  const capped = capManual({ DE: bag }, 4);
  assert.equal(Object.keys(capped.table.DE).length, 4);
  assert.equal(capped.dropped, 6, 'hand-typed text must never vanish silently');
});

test('saveManual reports the translations it could not keep', async () => {
  const port = memoryPort();
  const bag = {};
  for (let i = 0; i < 4100; i++) bag['id' + i] = 'value';
  assert.equal(await new Storage(port).saveManual({ DE: bag }), 100);
  assert.equal(await new Storage(port).saveManual({ DE: { a: 'Eins' } }), 0);
});

/* ------------------------------------------------------------------ */
/* Failure paths                                                       */
/* ------------------------------------------------------------------ */

test('a write that fails says so instead of pretending', async () => {
  assert.equal(await new Storage(memoryPort()).saveSettings({ mode: 'manual' }), true);
  assert.equal(await new Storage(brokenPort()).saveSettings({ mode: 'manual' }), false);
});

test('migration keeps the v1 blob when the new keys could not be written', async () => {
  // clientStorage over quota: reads work, writes do not.
  const map = new Map([[LEGACY_SETTINGS_KEY, { mode: 'deepl', deeplKey: 'dl-irreplaceable' }]]);
  const readOnlyPort = {
    get: async (k) => (map.has(k) ? map.get(k) : undefined),
    set: async () => {
      throw new Error('over quota');
    },
    remove: async (k) => void map.delete(k),
    keys: async () => Array.from(map.keys()),
  };

  const state = await new Storage(readOnlyPort).loadAll();

  assert.equal(state.secrets.deeplKey, 'dl-irreplaceable', 'this session still works');
  assert.ok(
    map.has(LEGACY_SETTINGS_KEY),
    'deleting v1 after a failed write destroys the only copy of the keys'
  );
});

test('migration removes the v1 blob once both halves are written', async () => {
  const port = memoryPort({ [LEGACY_SETTINGS_KEY]: { mode: 'deepl', deeplKey: 'dl-1' } });
  await new Storage(port).loadAll();
  assert.equal(port.map.has(LEGACY_SETTINGS_KEY), false);
});

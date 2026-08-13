/**
 * The registry is the single source of truth about providers, which only works
 * if nothing drifts away from it — including manifest.json.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PROVIDERS,
  PROVIDER_LIST,
  getProvider,
  allDomains,
  missingCredential,
  DEFAULT_SETTINGS,
  DEFAULT_SECRETS,
} from '../dist-test/lib.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

const stateWith = (overrides = {}) => ({
  settings: { ...DEFAULT_SETTINGS, ...overrides.settings },
  secrets: { ...DEFAULT_SECRETS, ...overrides.secrets },
  manual: overrides.manual || {},
});

test('every descriptor is listed exactly once, keyed by its own id', () => {
  const ids = Object.keys(PROVIDERS);
  assert.equal(PROVIDER_LIST.length, ids.length);
  for (const id of ids) assert.equal(PROVIDERS[id].id, id);
  const listed = PROVIDER_LIST.map((p) => p.id).sort();
  assert.deepEqual(listed, ids.slice().sort());
});

test('manifest.json allows exactly the domains the providers use', () => {
  const allowed = manifest.networkAccess.allowedDomains.slice().sort();
  assert.deepEqual(
    allDomains(),
    allowed,
    'manifest.json and the registry disagree about which hosts are reachable'
  );
});

test('an unknown mode falls back to manual rather than crashing', () => {
  assert.equal(getProvider('nope-not-a-provider').id, 'manual');
});

test('only the AI providers claim to shorten or honour budgets', () => {
  const capable = PROVIDER_LIST.filter((p) => p.capabilities.shorten || p.capabilities.budgets);
  assert.deepEqual(capable.map((p) => p.id).sort(), ['gemini', 'openai']);
  // A provider that can shorten must also accept budgets: the fit pass sends both.
  for (const p of PROVIDER_LIST) {
    if (p.capabilities.shorten) assert.equal(p.capabilities.budgets, true);
  }
});

test('the cache bucket names the model, not just the engine', () => {
  const a = PROVIDERS.openai.cacheKey(stateWith({ settings: { openaiModel: 'gpt-4o-mini' } }));
  const b = PROVIDERS.openai.cacheKey(stateWith({ settings: { openaiModel: 'gpt-5' } }));
  assert.notEqual(a, b, 'switching model must not replay the previous model’s cached output');
  assert.match(a, /gpt-4o-mini/);
});

test('DeepL Pro and Free share a bucket, Google and its free endpoint do not', () => {
  const s = stateWith();
  assert.equal(PROVIDERS.deepl.cacheKey(s), PROVIDERS['deepl-free'].cacheKey(s));
  assert.notEqual(PROVIDERS.google.cacheKey(s), PROVIDERS['google-free'].cacheKey(s));
});

test('manual is never cached', () => {
  assert.equal(PROVIDERS.manual.cacheKey(stateWith()), null);
});

test('every keyed provider declares exactly one credential field', () => {
  for (const descriptor of PROVIDER_LIST) {
    const credentials = descriptor.fields.filter((f) => f.credential);
    assert.ok(credentials.length <= 1, descriptor.id + ' has more than one credential field');
    if (descriptor.domains.length && descriptor.id !== 'google-free') {
      assert.equal(credentials.length, 1, descriptor.id + ' talks to the network without a key field');
    }
  }
});

test('secrets never live in the settings blob', () => {
  for (const descriptor of PROVIDER_LIST) {
    for (const field of descriptor.fields) {
      if (field.type !== 'password') continue;
      assert.equal(
        field.target.scope,
        'secret',
        descriptor.id + '.' + field.id + ' is a password stored as a setting'
      );
    }
  }
});

test('missingCredential reports the empty key and clears once it is filled', () => {
  assert.ok(missingCredential(PROVIDERS.openai, stateWith()));
  assert.equal(missingCredential(PROVIDERS.openai, stateWith({ secrets: { openaiKey: 'sk-x' } })), null);
  // Whitespace is not a key.
  assert.ok(missingCredential(PROVIDERS.openai, stateWith({ secrets: { openaiKey: '   ' } })));
  assert.equal(missingCredential(PROVIDERS['google-free'], stateWith()), null);
});

test('manual refuses to run until at least one language has entries', () => {
  const validate = PROVIDERS.manual.validate;
  assert.ok(validate({ targets: ['DE'], filled: () => 0 }));
  assert.equal(validate({ targets: ['DE'], filled: () => 3 }), null);
});

test('a provider can be constructed from its descriptor alone', () => {
  const transport = async () => ({ ok: true, status: 200, statusText: '', headers: {}, body: '{}' });
  for (const descriptor of PROVIDER_LIST) {
    const provider = descriptor.create({ ...stateWith(), transport });
    assert.equal(typeof provider.translate, 'function');
    assert.equal(
      typeof provider.shorten === 'function',
      descriptor.capabilities.shorten,
      descriptor.id + ' disagrees with its own shorten capability'
    );
  }
});

/**
 * The panel, rendered into a real DOM.
 *
 * These run against `src/ui/ui.html` itself rather than a hand-written
 * fixture, so a control the code reaches for but the template no longer has is
 * a test failure instead of a "Missing element #…" the first time someone opens
 * the plugin.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const template = fs.readFileSync(path.join(root, 'src/ui/ui.html'), 'utf8');

let lib;
let dom;

before(async () => {
  dom = new JSDOM('<!doctype html><html><body>' + template + '</body></html>', {
    url: 'https://localhost/',
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  // The panel talks to the sandbox through this; nothing is listening in a test.
  dom.window.parent = { postMessage() {} };

  lib = await import('../dist-test/lib.mjs');
});

function reset() {
  document.body.innerHTML = template;
}

/* ------------------------------------------------------------------ */
/* dom.ts — the element builder                                        */
/* ------------------------------------------------------------------ */

test('el() cannot be used to inject markup', () => {
  const hostile = '<img src=x onerror="globalThis.__pwned = true">';
  const node = lib.el('div', { text: hostile });

  assert.equal(node.textContent, hostile, 'the text must survive verbatim');
  assert.equal(node.querySelector('img'), null, 'and must never become an element');
  assert.equal(globalThis.__pwned, undefined);
});

test('el() sets the properties the views rely on', () => {
  const input = lib.el('input', {
    id: 'x',
    class: 'a b',
    type: 'password',
    value: 'sk-secret',
    placeholder: 'sk-…',
    checked: true,
    dataset: { provider: 'openai', field: 'key' },
  });

  assert.equal(input.id, 'x');
  assert.equal(input.className, 'a b');
  assert.equal(input.type, 'password');
  assert.equal(input.value, 'sk-secret');
  assert.equal(input.placeholder, 'sk-…');
  assert.equal(input.checked, true);
  assert.equal(input.dataset.provider, 'openai');
  assert.equal(input.dataset.field, 'key');
});

test('el() appends children and skips the empty ones', () => {
  const node = lib.el('div', {}, [
    lib.el('b', { text: 'bold' }),
    ' and ',
    null,
    undefined,
    false,
    lib.el('i', { text: 'italic' }),
  ]);
  assert.equal(node.textContent, 'bold and italic');
  assert.equal(node.children.length, 2);
});

test('replace() and clear() empty the node first', () => {
  const host = lib.el('div', {}, [lib.el('span', { text: 'old' })]);
  lib.replace(host, [lib.el('span', { text: 'new' })]);
  assert.equal(host.textContent, 'new');
  assert.equal(host.children.length, 1);
  lib.clear(host);
  assert.equal(host.children.length, 0);
});

/* ------------------------------------------------------------------ */
/* The mode picker is generated from the registry                      */
/* ------------------------------------------------------------------ */

test('every registered provider gets an option and a panel, with no markup in the template', () => {
  reset();
  assert.equal(
    template.indexOf('panel-openai'),
    -1,
    'ui.html must not carry provider-specific markup any more'
  );

  lib.buildModePicker();

  const select = document.getElementById('mode');
  const values = Array.from(select.querySelectorAll('option')).map((o) => o.value);
  assert.deepEqual(values.sort(), lib.PROVIDER_LIST.map((p) => p.id).sort());

  // Manual sits at the top level; the rest are grouped.
  const groups = Array.from(select.querySelectorAll('optgroup')).map((g) => g.label);
  assert.deepEqual(groups, ['AI', 'Machine translation']);

  for (const descriptor of lib.PROVIDER_LIST) {
    const panel = document.querySelector('[data-panel="' + descriptor.id + '"]');
    assert.ok(panel, 'no panel generated for ' + descriptor.id);
    for (const field of descriptor.fields) {
      const input = document.getElementById('field-' + descriptor.id + '-' + field.id);
      assert.ok(input, 'missing input for ' + descriptor.id + '.' + field.id);
      assert.equal(input.type, field.type);
      assert.equal(input.dataset.provider, descriptor.id);
    }
  }
});

test('credential fields are password inputs, so a key is never shoulder-readable', () => {
  reset();
  lib.buildModePicker();
  for (const descriptor of lib.PROVIDER_LIST) {
    for (const field of descriptor.fields) {
      if (!field.credential) continue;
      const input = document.getElementById('field-' + descriptor.id + '-' + field.id);
      assert.equal(input.type, 'password', descriptor.id + ' exposes its key in clear text');
    }
  }
});

test('the manual panel brings the string counter and editor host with it', () => {
  reset();
  lib.buildModePicker();
  assert.ok(document.getElementById('string-count'));
  assert.ok(document.getElementById('manual-editor'));
  assert.ok(document.getElementById('reload-strings'));
});

test('stored values populate the generated inputs, and only the active panel shows', () => {
  reset();
  lib.buildModePicker();

  lib.state.settings.mode = 'openai';
  lib.state.settings.openaiModel = 'gpt-4.1';
  lib.state.secrets.openaiKey = 'sk-stored';
  lib.state.secrets.deeplKey = 'dl-stored';

  lib.renderProviderFields();
  lib.renderMode();

  assert.equal(document.getElementById('field-openai-key').value, 'sk-stored');
  assert.equal(document.getElementById('field-openai-model').value, 'gpt-4.1');
  assert.equal(document.getElementById('field-deepl-key').value, 'dl-stored');

  const visible = Array.from(document.querySelectorAll('[data-panel]'))
    .filter((p) => !p.classList.contains('hidden'))
    .map((p) => p.dataset.panel);
  assert.deepEqual(visible, ['openai']);
  assert.equal(document.getElementById('mode').value, 'openai');
});

test('the privacy note follows whether the mode stores a key', () => {
  reset();
  lib.buildModePicker();

  lib.state.settings.mode = 'openai';
  lib.renderMode();
  assert.match(document.getElementById('privacy-note').textContent, /API key is stored/);

  lib.state.settings.mode = 'google-free';
  lib.renderMode();
  assert.match(document.getElementById('privacy-note').textContent, /No key is stored/);

  lib.state.settings.mode = 'manual';
  lib.renderMode();
  assert.ok(document.getElementById('privacy-note').classList.contains('hidden'));
});

/* ------------------------------------------------------------------ */
/* Document content is never trusted                                   */
/* ------------------------------------------------------------------ */

test('a hostile frame name is rendered as text, not as elements', () => {
  reset();
  lib.state.frames = [
    { id: '1', name: '<img src=x onerror="globalThis.__pwned=1">', textCount: 3 },
  ];
  lib.state.textCount = 3;

  lib.renderSelection();

  const list = document.getElementById('frame-list');
  assert.equal(list.querySelector('img'), null);
  assert.ok(list.textContent.indexOf('<img') >= 0, 'the name should still be readable');
  assert.equal(globalThis.__pwned, undefined);
  assert.match(document.getElementById('selection-summary').textContent, /1 frame · 3 text layers/);
});

test('a hostile layer name in a warning is rendered as text', () => {
  reset();
  lib.state.warnings = [
    {
      detail: { code: 'no-translation' },
      frame: 'Hero',
      language: 'DE',
      layer: '<script>globalThis.__pwned=1</script>',
      severity: 'warn',
    },
  ];

  lib.renderWarnings();

  const list = document.getElementById('warn-list');
  assert.equal(list.querySelector('script'), null);
  assert.equal(globalThis.__pwned, undefined);
  assert.match(list.textContent, /No translation available/);
  assert.equal(document.getElementById('warn-title').textContent, '1 warning');
});

/* ------------------------------------------------------------------ */
/* The rest of the panel                                               */
/* ------------------------------------------------------------------ */

test('an empty warning list says so rather than rendering nothing', () => {
  reset();
  lib.state.warnings = [];
  lib.renderWarnings();
  assert.match(document.getElementById('warn-list').textContent, /Nothing to report/);
  assert.equal(document.getElementById('warn-title').textContent, '0 warnings');
});

test('the summary renders every counter, and hides the ones that are zero', () => {
  reset();
  lib.state.warnings = [];
  lib.renderDone({
    sourceFrames: 3,
    languages: 2,
    framesCreated: 6,
    layersTranslated: 24,
    cacheHits: 5,
    shortened: 0,
    warnings: 1,
  });

  const text = document.getElementById('done-stats').textContent;
  assert.match(text, /3 source frames/);
  assert.match(text, /6 localized frames created/);
  assert.match(text, /5 reused from cache/);
  assert.ok(text.indexOf('shortened') < 0, 'a zero should not get its own line');
  assert.ok(text.indexOf('undefined') < 0);
  assert.equal(document.getElementById('done-warnings').disabled, true);
});

test('every option checkbox in the template is bound to a setting', () => {
  reset();
  lib.state.settings.options.groupPerLanguage = true;
  lib.state.settings.options.keepOriginals = false;
  lib.state.settings.debug = true;
  lib.state.settings.doNotTranslate = 'HabitFlow';
  lib.state.settings.glossary = 'Streak = DE: Serie';

  // Throws on the first id the template is missing.
  lib.renderOptions();

  assert.equal(document.getElementById('opt-group').checked, true);
  assert.equal(document.getElementById('opt-keep').checked, false);
  assert.equal(document.getElementById('opt-debug').checked, true);
  assert.equal(document.getElementById('dnt').value, 'HabitFlow');
  assert.match(document.getElementById('glossary-state').textContent, /1 term/);
});

test('switching views leaves exactly one active, and the footer follows', () => {
  reset();
  const active = () =>
    ['main', 'progress', 'done', 'warnings'].filter((v) =>
      document.getElementById('view-' + v).classList.contains('active')
    );

  lib.showView('progress');
  assert.deepEqual(active(), ['progress']);
  assert.ok(document.getElementById('footer').classList.contains('hidden'));

  lib.showView('main');
  assert.deepEqual(active(), ['main']);
  assert.equal(document.getElementById('footer').classList.contains('hidden'), false);
});

test('a form error shows and clears', () => {
  reset();
  lib.showFormError('Select at least one frame.');
  const el = document.getElementById('form-error');
  assert.equal(el.textContent, 'Select at least one frame.');
  assert.equal(el.classList.contains('hidden'), false);

  lib.showFormError(null);
  assert.equal(el.textContent, '');
  assert.ok(el.classList.contains('hidden'));
});

test('the manual editor asks for a language before it asks for translations', () => {
  reset();
  lib.buildModePicker();
  lib.state.settings.mode = 'manual';
  lib.state.settings.sourceLanguage = 'EN';
  lib.state.settings.targets = [];
  lib.state.strings = [{ id: 'a', text: 'Track your habits', count: 2 }];

  lib.renderManualEditor();
  assert.match(document.getElementById('manual-editor').textContent, /Pick at least one target/);

  lib.state.settings.targets = ['DE', 'FR'];
  lib.renderManualEditor();

  const blocks = document.querySelectorAll('.lang-block');
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].dataset.code, 'DE');
  assert.match(document.querySelector('[data-fill="DE"]').textContent, /0 \/ 1 filled/);
  assert.equal(document.getElementById('string-count').textContent, '1');
});

test('the source language is never offered as its own target', () => {
  reset();
  lib.buildModePicker();
  lib.state.settings.mode = 'manual';
  lib.state.settings.sourceLanguage = 'EN';
  lib.state.settings.targets = ['EN', 'DE'];
  lib.state.strings = [{ id: 'a', text: 'One', count: 1 }];
  lib.state.manualSignature = '';

  lib.renderManualEditor();

  const codes = Array.from(document.querySelectorAll('.lang-block')).map((b) => b.dataset.code);
  assert.deepEqual(codes, ['DE']);
});

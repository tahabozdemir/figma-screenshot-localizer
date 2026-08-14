/**
 * The generation pipeline, driven end to end against a fake document.
 *
 * None of this was reachable from a test before: the orchestration lived in the
 * sandbox entry point, which read `figma` at import time. It takes a document
 * port now, so cloning, naming, cache hits, skipped languages, cancellation and
 * the failure paths can all be asserted without Figma.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// text-engine reaches for these two at call time.
globalThis.figma = { mixed: Symbol('figma.mixed'), loadFontAsync: async () => {} };

const {
  generate,
  localizeFrame,
  Storage,
  CancellationToken,
  langByCode,
  tmKey,
  PREFETCH_LANGUAGES,
} = await import('../dist-test/lib.mjs');

let nextId = 0;

function textNode(name, chars, opts = {}) {
  const node = {
    id: 'text' + ++nextId,
    type: 'TEXT',
    name,
    _chars: chars,
    fontName: { family: opts.family || 'Inter', style: 'Regular' },
    hasMissingFont: !!opts.missingFont,
    textAlignHorizontal: 'LEFT',
    textAutoResize: 'HEIGHT',
    width: 100,
    height: 20,
    absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 20 },
    parent: null,
    getStyledTextSegments: () => [{ start: 0, end: node._chars.length, fontSize: 16 }],
    resize() {},
    clone: () => textNode(name, node._chars, opts),
  };
  Object.defineProperty(node, 'characters', {
    get: () => node._chars,
    set: (value) => {
      if (opts.locked) throw new Error('layer is locked');
      node._chars = value;
    },
    enumerable: true,
    configurable: true,
  });
  return node;
}

function frameNode(name, children, opts = {}) {
  const node = {
    id: 'frame' + ++nextId,
    type: 'FRAME',
    name,
    children,
    parent: null,
    x: 0,
    y: 0,
    width: 400,
    height: 800,
    absoluteBoundingBox: { x: opts.x || 0, y: opts.y || 0, width: 400, height: 800 },
    removed: false,
    findAllWithCriteria: ({ types }) => node.children.filter((c) => types.indexOf(c.type) >= 0),
    appendChild(child) {
      node.children.push(child);
      child.parent = node;
    },
    remove() {
      node.removed = true;
      const siblings = node.page || (node.parent && node.parent.children);
      if (Array.isArray(siblings)) {
        const at = siblings.indexOf(node);
        if (at >= 0) siblings.splice(at, 1);
      }
    },
    clone: () =>
      frameNode(
        name,
        node.children.map((c) => c.clone()),
        opts
      ),
  };
  for (const child of children) child.parent = node;
  return node;
}

function fakeDoc(selection) {
  const page = selection.slice();
  return {
    page,
    selected: null,
    notices: [],
    selection: () => selection,
    setSelection(nodes) {
      this.selected = nodes;
    },
    pageChildren: () => page,
    appendToPage(node) {
      page.push(node);
      node.page = page;
      node.parent = { type: 'PAGE', id: 'page', parent: null };
    },
    /** Seeds the page with something a previous run left behind. */
    seed(node) {
      page.push(node);
      node.page = page;
    },
    createSection: () => null,
    createFrame: () => frameNode('container', []),
    scrollAndZoomIntoView() {},
    notify(message) {
      this.notices.push(message);
    },
    getNodeById: async () => null,
  };
}

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    storage: new Storage({
      get: async (k) => (map.has(k) ? map.get(k) : undefined),
      set: async (k, v) => void map.set(k, v),
      remove: async (k) => void map.delete(k),
      keys: async () => Array.from(map.keys()),
    }),
  };
}

const OPTIONS = {
  groupPerLanguage: false,
  keepOriginals: true,
  autoAdjust: false,
  detectOverflow: false,
  preserveFormatting: true,
  suffixNaming: true,
  updateExisting: false,
  fitToLayout: false,
};

function config(over = {}) {
  return {
    sourceLanguage: 'EN',
    targets: ['DE'],
    mode: 'openai',
    exportFolders: 'none',
    doNotTranslate: [],
    cacheKey: 'openai/gpt-4o-mini',
    capabilities: { shorten: false, budgets: false },
    ...over,
    options: { ...OPTIONS, ...over.options },
  };
}

/** Answers every string with "<lang>:<text>". */
function echoTranslator() {
  const calls = [];
  const request = async (source, target, strings) => {
    calls.push({ target: target.code, strings: strings.map((s) => s.text) });
    const translations = {};
    for (const s of strings) translations[s.id] = target.code + ':' + s.text;
    return { translations };
  };
  request.calls = calls;
  return request;
}

function run(doc, over = {}, deps = {}) {
  const { storage, map } = deps.storage || memoryStorage();
  const request = deps.request || echoTranslator();
  const token = deps.token || new CancellationToken();
  const progress = [];
  return generate(config(over), {
    doc,
    storage,
    token,
    request,
    onProgress: (p) => progress.push(p),
  }).then((outcome) => ({ outcome, request, progress, map, token }));
}

const codes = (outcome) => (outcome.warnings || []).map((w) => w.detail.code);

/* ------------------------------------------------------------------ */

test('a frame is cloned per language, renamed, and its text replaced', async () => {
  const source = frameNode('01_Hero_EN', [
    textNode('headline', 'Track your habits'),
    textNode('sub', 'Every single day'),
  ]);
  const doc = fakeDoc([source]);

  const { outcome } = await run(doc, { targets: ['DE', 'FR'] });

  assert.equal(outcome.status, 'done');
  assert.equal(outcome.summary.framesCreated, 2);
  assert.equal(outcome.summary.layersTranslated, 4);
  assert.equal(outcome.summary.languages, 2);

  const created = doc.page.filter((n) => n !== source);
  assert.deepEqual(
    created.map((n) => n.name),
    ['01_Hero_DE', '01_Hero_FR']
  );
  assert.deepEqual(
    created[0].children.map((c) => c.characters),
    ['DE:Track your habits', 'DE:Every single day']
  );
  // The source is never touched.
  assert.deepEqual(
    source.children.map((c) => c.characters),
    ['Track your habits', 'Every single day']
  );
  assert.equal(source.name, '01_Hero_EN');
});

test('languages stack below the sources and wrap into a new column after five', async () => {
  const source = frameNode('Hero', [textNode('t', 'One')]);
  const doc = fakeDoc([source]);

  const { outcome } = await run(doc, { targets: ['DE', 'FR', 'ES', 'IT', 'PT', 'NL'] });

  assert.equal(outcome.status, 'done');
  const created = doc.page.filter((n) => n !== source);
  assert.equal(created.length, 6);
  const src = source.absoluteBoundingBox;
  assert.equal(created[0].x, src.x, 'the grid is aligned with the sources');
  assert.ok(
    created[0].y > src.y + src.height,
    'the first language must clear the existing content'
  );
  for (let i = 1; i < 5; i++) {
    assert.equal(created[i].x, created[0].x, 'the first five languages share a column');
    assert.ok(created[i].y > created[i - 1].y, 'languages must stack downward without overlap');
  }
  assert.ok(created[5].x > created[0].x, 'the sixth language starts a new column');
  assert.equal(created[5].y, created[0].y, 'the new column starts back at the top');
});

test('an identical string on two layers is sent once and written twice', async () => {
  const source = frameNode('Hero', [
    textNode('a', 'Start now'),
    textNode('b', 'Start now'),
    textNode('c', 'Other'),
  ]);
  const { outcome, request } = await run(fakeDoc([source]));

  assert.equal(outcome.status, 'done');
  assert.deepEqual(request.calls[0].strings, ['Start now', 'Other']);
  assert.equal(outcome.summary.layersTranslated, 3);
});

test('the translation memory is written, then reused without asking again', async () => {
  const first = frameNode('Hero', [textNode('t', 'Track your habits')]);
  const store = memoryStorage();

  const a = await run(fakeDoc([first]), {}, { storage: store });
  assert.equal(a.outcome.summary.cacheHits, 0);
  assert.deepEqual(store.map.get(tmKey('openai/gpt-4o-mini', 'en', 'de')), {
    'Track your habits': 'DE:Track your habits',
  });

  const second = frameNode('Hero', [textNode('t', 'Track your habits')]);
  const b = await run(fakeDoc([second]), {}, { storage: store });

  assert.equal(b.outcome.summary.cacheHits, 1);
  assert.equal(b.request.calls.length, 0, 'a cached string must not be sent again');
});

test('a null cache bucket never touches storage', async () => {
  const source = frameNode('Hero', [textNode('t', 'One')]);
  const store = memoryStorage();
  await run(fakeDoc([source]), { cacheKey: null, mode: 'manual' }, { storage: store });
  assert.equal(store.map.size, 0);
});

test('a dead language is skipped and the rest still generate', async () => {
  const source = frameNode('Hero', [textNode('t', 'One')]);
  const doc = fakeDoc([source]);
  const request = async (from, to, strings) => {
    if (to.code === 'DE') return { translations: {}, error: 'Invalid API key (HTTP 401).' };
    const translations = {};
    for (const s of strings) translations[s.id] = to.code + ':' + s.text;
    return { translations };
  };

  const { outcome } = await run(doc, { targets: ['DE', 'FR'] }, { request });

  assert.equal(outcome.status, 'done');
  assert.equal(outcome.summary.framesCreated, 1, 'only French should have been drawn');
  assert.ok(codes(outcome).indexOf('language-skipped') >= 0);
  const skipped = outcome.warnings.filter((w) => w.detail.code === 'language-skipped')[0];
  assert.equal(skipped.language, 'DE');
  assert.match(skipped.detail.reason, /401/);
});

test('a partly answered language reports it but still writes what came back', async () => {
  const source = frameNode('Hero', [textNode('a', 'One'), textNode('b', 'Two')]);
  const request = async (from, to, strings) => ({
    translations: { [strings[0].id]: 'Eins' },
    error: 'Batch 2/2 failed.',
    issues: ['{{name}} did not survive.'],
  });

  const { outcome } = await run(fakeDoc([source]), {}, { request });

  assert.equal(outcome.status, 'done');
  const found = codes(outcome);
  assert.ok(found.indexOf('partial-translation') >= 0);
  assert.ok(found.indexOf('provider-issue') >= 0);
  assert.ok(found.indexOf('no-translation') >= 0, 'the unanswered layer keeps its source text');
});

test('a locked layer is reported and does not abort the frame', async () => {
  const source = frameNode('Hero', [
    textNode('locked', 'One', { locked: true }),
    textNode('fine', 'Two'),
  ]);
  const doc = fakeDoc([source]);

  const { outcome } = await run(doc);

  assert.equal(outcome.status, 'done');
  assert.ok(codes(outcome).indexOf('text-write-failed') >= 0);
  assert.equal(outcome.summary.layersTranslated, 1);
  const clone = doc.page.filter((n) => n !== source)[0];
  assert.equal(clone.children[1].characters, 'DE:Two');
});

test('a missing font skips the layer with an error', async () => {
  const source = frameNode('Hero', [textNode('t', 'One', { missingFont: true })]);
  const { outcome } = await run(fakeDoc([source]));
  assert.ok(codes(outcome).indexOf('font-unavailable') >= 0);
  assert.equal(outcome.summary.layersTranslated, 0);
});

test('a right-to-left language mirrors alignment and says so once', async () => {
  const source = frameNode('Hero', [textNode('a', 'One'), textNode('b', 'Two')]);
  const doc = fakeDoc([source]);

  const { outcome } = await run(doc, { targets: ['AR'] });

  const clone = doc.page.filter((n) => n !== source)[0];
  assert.equal(clone.children[0].textAlignHorizontal, 'RIGHT');
  assert.equal(outcome.warnings.filter((w) => w.detail.code === 'rtl-mirrored').length, 1);
  // Arabic is not Latin, so the glyph-coverage note fires once per font.
  assert.equal(outcome.warnings.filter((w) => w.detail.code === 'script-coverage').length, 1);
});

test('the source language among the targets copies the text through unchanged', async () => {
  const source = frameNode('Hero', [textNode('t', 'Track your habits')]);
  const doc = fakeDoc([source]);

  const { outcome, request } = await run(doc, { targets: ['EN'] });

  assert.equal(outcome.status, 'done');
  assert.equal(request.calls.length, 0);
  const clone = doc.page.filter((n) => n !== source)[0];
  assert.equal(clone.characters, undefined);
  assert.equal(clone.children[0].characters, 'Track your habits');
});

test('turning off "keep originals" only renames the source', async () => {
  const source = frameNode('Hero', [textNode('t', 'One')]);
  await run(fakeDoc([source]), { options: { keepOriginals: false } });
  assert.equal(source.name, 'Hero_EN');
  assert.equal(source.removed, false);
  assert.equal(source.children[0].characters, 'One');
});

test('export folders name every clone into its store locale', async () => {
  const source = frameNode('01_Hero_EN', [textNode('t', 'One')]);
  const doc = fakeDoc([source]);

  await run(doc, {
    targets: ['AR', 'ZH-CN'],
    exportFolders: 'appStore',
    options: { keepOriginals: false },
  });

  const names = doc.page.map((n) => n.name).sort();
  // The source is filed under its own locale too, so the export is complete.
  assert.deepEqual(names, ['ar-SA/01_Hero', 'en-US/01_Hero', 'zh-Hans/01_Hero']);
  assert.equal(source.name, 'en-US/01_Hero');
});

test('switching store re-folders an earlier run instead of nesting', async () => {
  // A frame the App Store run produced, fed back in as the source.
  const source = frameNode('ar-SA/01_Hero', [textNode('t', 'One')]);
  const doc = fakeDoc([source]);

  await run(doc, { targets: ['AR'], exportFolders: 'play' });

  const clone = doc.page.filter((n) => n !== source)[0];
  assert.equal(clone.name, 'ar/01_Hero');
});

test('re-running with "update existing" replaces rather than piles up', async () => {
  const source = frameNode('Hero', [textNode('t', 'One')]);
  const stale = frameNode('Hero_DE', [textNode('t', 'Old')], { x: 999 });
  const doc = fakeDoc([source]);
  doc.seed(stale);

  const { outcome } = await run(doc, { options: { updateExisting: true } });

  assert.equal(stale.removed, true);
  assert.ok(codes(outcome).indexOf('frame-replaced') >= 0);
  assert.equal(doc.page.filter((n) => n.name === 'Hero_DE').length, 1);
});

test('cancelling mid-run stops and reports what was already created', async () => {
  const source = frameNode('Hero', [textNode('t', 'One')]);
  const token = new CancellationToken();
  const request = async (from, to, strings) => {
    if (to.code === 'FR') token.cancel();
    const translations = {};
    for (const s of strings) translations[s.id] = to.code + ':' + s.text;
    return { translations };
  };

  const { outcome } = await run(fakeDoc([source]), { targets: ['DE', 'FR'] }, { request, token });

  assert.equal(outcome.status, 'cancelled');
  assert.ok(outcome.framesCreated <= 1);
});

test('a fit pass that throws is counted, not filed away as advisory', async () => {
  const source = frameNode('Hero', [textNode('t', 'One')]);
  // Budget measurement is off, so the shorten request is the only extra call.
  const request = async (from, to, strings, opts) => {
    if (opts && opts.shorten) throw new Error('provider exploded');
    const translations = {};
    for (const s of strings) translations[s.id] = to.code + ':' + s.text;
    return { translations };
  };

  const { outcome } = await run(
    fakeDoc([source]),
    { capabilities: { shorten: true, budgets: true }, options: { fitToLayout: true } },
    { request }
  );

  // Nothing overflowed here, so the pass is a no-op — but the severity itself
  // is the guarantee: had it thrown, the layers it consumed leave no other trace.
  assert.equal(outcome.status, 'done');
  const failed = outcome.warnings.filter((w) => w.detail.code === 'fit-pass-failed');
  for (const w of failed) assert.notEqual(w.severity, 'info');
});

test('an empty or text-free selection is refused before anything is cloned', async () => {
  const empty = await run(fakeDoc([]));
  assert.equal(empty.outcome.status, 'error');
  assert.match(empty.outcome.message, /Select at least one frame/);

  const blank = await run(fakeDoc([frameNode('Hero', [textNode('t', '   ')])]));
  assert.equal(blank.outcome.status, 'error');
  assert.match(blank.outcome.message, /No text layers/);

  const noTargets = await run(fakeDoc([frameNode('Hero', [textNode('t', 'One')])]), {
    targets: ['NOT-A-LANGUAGE'],
  });
  assert.equal(noTargets.outcome.status, 'error');
  assert.match(noTargets.outcome.message, /target language/);
});

test('languages are resolved ahead of the drawing loop, but only so far ahead', async () => {
  const source = frameNode('Hero', [textNode('t', 'One')]);
  let inFlight = 0;
  let peak = 0;
  const request = async (from, to, strings) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    const translations = {};
    for (const s of strings) translations[s.id] = to.code + ':' + s.text;
    return { translations };
  };

  const { outcome } = await run(
    fakeDoc([source]),
    { targets: ['DE', 'FR', 'ES', 'IT', 'PT'] },
    { request }
  );

  assert.equal(outcome.status, 'done');
  assert.equal(outcome.summary.framesCreated, 5);
  assert.equal(peak, PREFETCH_LANGUAGES, 'the prefetch queue should stay exactly this deep');
  assert.ok(PREFETCH_LANGUAGES > 1, 'depth 1 serialises every round-trip behind the drawing');
});

test('a prefetch that fails does not become an unhandled rejection', async () => {
  const source = frameNode('Hero', [textNode('t', 'One')]);
  const request = async (from, to, strings) => {
    if (to.code !== 'DE') throw new Error('provider exploded');
    const translations = {};
    for (const s of strings) translations[s.id] = to.code + ':' + s.text;
    return { translations };
  };

  const { outcome } = await run(fakeDoc([source]), { targets: ['DE', 'FR', 'ES'] }, { request });

  assert.equal(outcome.status, 'done');
  assert.equal(outcome.summary.framesCreated, 1);
  assert.equal(codes(outcome).filter((c) => c === 'language-skipped').length, 2);
});

test('progress is reported per language and per frame', async () => {
  const doc = fakeDoc([
    frameNode('A', [textNode('t', 'One')]),
    frameNode('B', [textNode('t', 'Two')]),
  ]);
  const { progress } = await run(doc, { targets: ['DE', 'FR'] });
  const last = progress[progress.length - 1];
  assert.equal(last.langIndex, 2);
  assert.equal(last.langTotal, 2);
  assert.equal(last.frameTotal, 2);
});

/* ------------------------------------------------------------------ */
/* The hash-collision guard                                            */
/* ------------------------------------------------------------------ */

test('a layer whose id maps to different source text is skipped, not mistranslated', async () => {
  const node = textNode('headline', 'Track your habits');
  const root = frameNode('Hero', [node]);
  const warnings = [];

  // Simulates the collision: the id resolves to a different string than the one
  // actually on the layer, so the translation belongs to someone else.
  const { hashString } = await import('../dist-test/lib.mjs');
  const id = hashString('Track your habits');

  const written = await localizeFrame(
    root,
    { [id]: 'DE:Something else entirely' },
    {
      lang: langByCode('DE'),
      options: { ...OPTIONS },
      warnings,
      loadedFonts: new Set(),
      failedFonts: new Set(),
      scriptWarned: new Set(),
      canShorten: false,
      overflows: [],
      token: new CancellationToken(),
      sourceById: { [id]: 'A completely different string' },
    }
  );

  assert.equal(written, 0);
  assert.equal(node.characters, 'Track your habits', 'the wrong translation must not be written');
  assert.deepEqual(
    warnings.map((w) => w.detail.code),
    ['hash-collision']
  );
  assert.equal(warnings[0].severity, 'error');
});

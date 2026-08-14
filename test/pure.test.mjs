/**
 * Unit tests for the pure logic — the parts that can break silently and would
 * only be noticed as a bad translation weeks later.
 *
 *   npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  hashString,
  langByCode,
  stripLanguageTag,
  localizedName,
  googleCode,
  deeplSource,
  deeplTarget,
  storeLocale,
  chunk,
  protectedRanges,
  markProtected,
  unmarkProtected,
  decodeEntities,
  parseTranslations,
  parseGlossary,
  glossaryFor,
  buildSystemPrompt,
  buildUserPayload,
  buildShortenPrompt,
  qualityIssues,
  modelRejectsTemperature,
} from '../dist-test/lib.mjs';

const EN = langByCode('EN');
const DE = langByCode('DE');
const TR = langByCode('TR');
const AR = langByCode('AR');

/* ------------------------------------------------------------------ */
/* hashString                                                          */
/* ------------------------------------------------------------------ */

test('hashString is deterministic and distinguishes similar strings', () => {
  assert.equal(hashString('Track your habits'), hashString('Track your habits'));
  assert.notEqual(hashString('Track your habits'), hashString('Track your habit'));
  assert.notEqual(hashString('ab'), hashString('ba'));
  assert.notEqual(hashString(''), hashString(' '));
});

test('hashString survives emoji and newlines', () => {
  const value = 'Stay on track 🔥\nEvery single day';
  assert.equal(hashString(value), hashString(value));
  assert.match(hashString(value), /^t[0-9a-z]+$/);
});

/* ------------------------------------------------------------------ */
/* Frame naming                                                        */
/* ------------------------------------------------------------------ */

const SUFFIX = { suffixNaming: true, exportFolders: 'none' };
const BRACKET = { suffixNaming: false, exportFolders: 'none' };
const APP_STORE = { suffixNaming: true, exportFolders: 'appStore' };
const PLAY = { suffixNaming: true, exportFolders: 'play' };
const TAG = { suffixNaming: false, exportFolders: 'tag' };

test('stripLanguageTag only strips codes it knows', () => {
  assert.equal(stripLanguageTag('01_Hero_EN'), '01_Hero');
  assert.equal(stripLanguageTag('[EN] Hero'), 'Hero');
  assert.equal(stripLanguageTag('01_Hero_ZH-CN'), '01_Hero');
  // Not a language code — must survive untouched.
  assert.equal(stripLanguageTag('Hero_V2'), 'Hero_V2');
  assert.equal(stripLanguageTag('Hero'), 'Hero');
});

test('stripLanguageTag strips a store-locale folder, not any folder', () => {
  assert.equal(stripLanguageTag('ar-SA/01_Hero'), '01_Hero');
  assert.equal(stripLanguageTag('zh-Hant/01_Hero'), '01_Hero');
  // Play's codes count too, so switching store re-folders cleanly.
  assert.equal(stripLanguageTag('zh-TW/01_Hero'), '01_Hero');
  assert.equal(stripLanguageTag('tr-TR/01_Hero'), '01_Hero');
  // A folder of the user's own must survive, tag stripping and all.
  assert.equal(stripLanguageTag('Screens/01_Hero_EN'), 'Screens/01_Hero');
  // Only the leading segment is a locale — a deeper one is the design's own.
  assert.equal(stripLanguageTag('en-US/Screens/01 Hero'), 'Screens/01 Hero');
});

test('localizedName retags rather than appending', () => {
  assert.equal(localizedName('01_Hero_EN', DE, SUFFIX), '01_Hero_DE');
  assert.equal(localizedName('01_Hero_EN', DE, BRACKET), '[DE] 01_Hero');
  assert.equal(localizedName('[EN] Hero', TR, SUFFIX), 'Hero_TR');
  // Re-running on an already localized frame must not stack tags.
  assert.equal(
    localizedName(localizedName('Hero_EN', DE, SUFFIX), langByCode('FR'), SUFFIX),
    'Hero_FR'
  );
});

test('export folders name frames into the chosen store’s locale', () => {
  assert.equal(localizedName('01_Hero_EN', AR, APP_STORE), 'ar-SA/01_Hero');
  assert.equal(localizedName('01_Hero', langByCode('ZH-CN'), APP_STORE), 'zh-Hans/01_Hero');
  assert.equal(localizedName('01_Hero', langByCode('ZH-TW'), APP_STORE), 'zh-Hant/01_Hero');
  // The same three languages, filed the way Play wants them.
  assert.equal(localizedName('01_Hero_EN', AR, PLAY), 'ar/01_Hero');
  assert.equal(localizedName('01_Hero', langByCode('ZH-CN'), PLAY), 'zh-CN/01_Hero');
  assert.equal(localizedName('01_Hero', langByCode('ZH-TW'), PLAY), 'zh-TW/01_Hero');
  // The folder replaces the tag rather than stacking with it.
  assert.equal(localizedName('[EN] Hero', DE, APP_STORE), 'de-DE/Hero');
  // Switching store re-folders instead of nesting.
  assert.equal(localizedName(localizedName('Hero', AR, APP_STORE), AR, PLAY), 'ar/Hero');
  assert.equal(localizedName(localizedName('Hero', DE, PLAY), DE, TAG), 'de/Hero');
});

test('store locales follow each store, not the BCP-47 tag', () => {
  // The App Store regionalizes some languages Play leaves plain, and vice versa.
  assert.equal(storeLocale(AR, 'appStore'), 'ar-SA');
  assert.equal(storeLocale(AR, 'play'), 'ar');
  assert.equal(storeLocale(TR, 'appStore'), 'tr');
  assert.equal(storeLocale(TR, 'play'), 'tr-TR');
  assert.equal(storeLocale(langByCode('ZH-CN'), 'appStore'), 'zh-Hans');
  assert.equal(storeLocale(langByCode('ZH-CN'), 'play'), 'zh-CN');
  // Norwegian's tag is "nb" and neither store agrees with it.
  assert.equal(storeLocale(langByCode('NO'), 'appStore'), 'no');
  assert.equal(storeLocale(langByCode('NO'), 'play'), 'no-NO');
  assert.equal(storeLocale(langByCode('NO'), 'tag'), 'nb');
  // Both stores regionalize English the same way.
  assert.equal(storeLocale(EN, 'appStore'), 'en-US');
  assert.equal(storeLocale(EN, 'play'), 'en-US');
  assert.equal(storeLocale(EN, 'tag'), 'en');
});

test('a regional variant is its own language, filed where each store wants it', () => {
  const gb = langByCode('EN-GB');
  const mx = langByCode('ES-MX');
  const br = langByCode('PT-BR');

  // App Store and Play agree on the Englishes…
  assert.equal(storeLocale(gb, 'appStore'), 'en-GB');
  assert.equal(storeLocale(gb, 'play'), 'en-GB');
  // …and disagree on Mexican Spanish, which Play only has as Latin America.
  assert.equal(storeLocale(mx, 'appStore'), 'es-MX');
  assert.equal(storeLocale(mx, 'play'), 'es-419');
  assert.equal(storeLocale(br, 'appStore'), 'pt-BR');

  // The tag is what the AI providers are told to translate into, and it is
  // distinct from the base language — which is what keeps the two apart in
  // the translation memory.
  assert.equal(gb.tag, 'en-GB');
  assert.notEqual(gb.tag, langByCode('EN').tag);

  // Naming keeps the variant intact rather than mistaking "EN" for the tag.
  assert.equal(localizedName('01_Hero_EN', gb, SUFFIX), '01_Hero_EN-GB');
  assert.equal(stripLanguageTag('01_Hero_EN-GB'), '01_Hero');
  assert.equal(localizedName('en-US/01_Hero', gb, APP_STORE), 'en-GB/01_Hero');
});

test('engine language codes map to the documented variants', () => {
  assert.equal(googleCode(langByCode('ZH-CN')), 'zh-CN');
  assert.equal(deeplTarget(EN), 'EN-US');
  assert.equal(deeplTarget(langByCode('PT')), 'PT-PT');
  assert.equal(deeplTarget(langByCode('NO')), 'NB');
  // Source codes are always the plain language, never a regional variant.
  assert.equal(deeplSource(langByCode('ZH-CN')), 'ZH');
  assert.equal(deeplSource(DE), 'DE');
  assert.equal(deeplSource(langByCode('EN-GB')), 'EN');
  assert.equal(deeplTarget(langByCode('EN-GB')), 'EN-GB');
  assert.equal(deeplTarget(langByCode('PT-BR')), 'PT-BR');
  // Google has one code for every English, which the providers guard against.
  assert.equal(googleCode(langByCode('EN-GB')), 'en');
  assert.equal(googleCode(langByCode('ES-MX')), 'es');
});

/* ------------------------------------------------------------------ */
/* Batching                                                            */
/* ------------------------------------------------------------------ */

const strings = (n, length = 10) =>
  Array.from({ length: n }, (_, i) => ({
    id: 'id' + i,
    text: 'x'.repeat(length),
    count: 1,
  }));

test('chunk respects the item limit and loses nothing', () => {
  const items = strings(95);
  const batches = chunk(items, { maxItems: 40, maxChars: 100000, concurrency: 1 });
  assert.deepEqual(
    batches.map((b) => b.length),
    [40, 40, 15]
  );
  assert.equal(batches.flat().length, items.length);
});

test('chunk respects the character limit', () => {
  const batches = chunk(strings(10, 100), { maxItems: 40, maxChars: 250, concurrency: 1 });
  for (const batch of batches) {
    const chars = batch.reduce((sum, s) => sum + s.text.length, 0);
    assert.ok(chars <= 250, 'batch of ' + chars + ' characters exceeded the limit');
  }
  assert.equal(batches.flat().length, 10);
});

test('chunk still emits a single string that is over the limit on its own', () => {
  const batches = chunk(strings(1, 5000), { maxItems: 40, maxChars: 100, concurrency: 1 });
  assert.equal(batches.length, 1);
  assert.equal(batches[0].length, 1);
});

test('chunk on an empty list produces no batches', () => {
  assert.deepEqual(chunk([], { maxItems: 40, maxChars: 100, concurrency: 1 }), []);
});

/* ------------------------------------------------------------------ */
/* Placeholder protection                                              */
/* ------------------------------------------------------------------ */

test('protectedRanges finds every placeholder shape', () => {
  const text = 'Hi {{name}}, you have {count} left — %s and %1$s and <b>bold</b> and [[TOKEN]]';
  const ranges = protectedRanges(text, []);
  const found = ranges.map((r) => text.slice(r.start, r.end));
  assert.deepEqual(found, ['{{name}}', '{count}', '%s', '%1$s', '<b>', '</b>', '[[TOKEN]]']);
});

test('protectedRanges merges overlapping terms and placeholders', () => {
  const text = 'HabitFlow tracks {{name}}';
  const ranges = protectedRanges(text, ['HabitFlow', 'Flow']);
  // "Flow" sits inside "HabitFlow" — one merged range, not two.
  assert.equal(ranges.length, 2);
  assert.equal(text.slice(ranges[0].start, ranges[0].end), 'HabitFlow');
});

test('markProtected/unmarkProtected round-trips through the DeepL tag', () => {
  const text = 'Open HabitFlow to see {{count}} streaks';
  const marked = markProtected(text, ['HabitFlow'], '<x>', '</x>');
  assert.ok(marked.includes('<x>HabitFlow</x>'));
  assert.ok(marked.includes('<x>{{count}}</x>'));
  assert.equal(unmarkProtected(marked, 'x'), text);
});

test('markProtected escapes markup so the engine cannot re-interpret it', () => {
  const text = 'Tap <b>Start</b> & go';
  const marked = markProtected(text, [], '<span translate="no">', '</span>');
  assert.ok(marked.includes('&amp;'), 'ampersand must be escaped');
  assert.ok(!marked.includes('<b>'), 'the raw tag must not survive unescaped');
  assert.equal(unmarkProtected(marked, 'span'), text);
});

test('markProtected leaves plain text intact apart from escaping', () => {
  assert.equal(unmarkProtected(markProtected('Just words', [], '<x>', '</x>'), 'x'), 'Just words');
});

/* ------------------------------------------------------------------ */
/* Entities                                                            */
/* ------------------------------------------------------------------ */

test('decodeEntities handles named and numeric entities', () => {
  assert.equal(decodeEntities('Tom &amp; Jerry'), 'Tom & Jerry');
  assert.equal(decodeEntities('it&#39;s'), "it's");
  assert.equal(decodeEntities('&lt;b&gt;'), '<b>');
  assert.equal(decodeEntities('&#x27;'), "'");
});

test('decodeEntities keeps astral characters intact', () => {
  // fromCharCode would truncate this to a different, broken character.
  assert.equal(decodeEntities('Nice &#128512;'), 'Nice 😀');
  assert.equal(decodeEntities('Nice &#x1F600;'), 'Nice 😀');
});

test('decodeEntities leaves unknown entities alone', () => {
  assert.equal(decodeEntities('100&percnt; done'), '100&percnt; done');
  assert.equal(decodeEntities('&#999999999;'), '&#999999999;');
});

/* ------------------------------------------------------------------ */
/* Model output parsing                                                */
/* ------------------------------------------------------------------ */

const expected = [
  { id: 'a', text: 'One', count: 1 },
  { id: 'b', text: 'Two', count: 1 },
];

test('parseTranslations reads the documented shape', () => {
  const out = parseTranslations('{"translations":{"a":"Eins","b":"Zwei"}}', expected);
  assert.deepEqual(out, { a: 'Eins', b: 'Zwei' });
});

test('parseTranslations survives code fences and chatter', () => {
  const raw = 'Sure!\n```json\n{"translations":{"a":"Eins"}}\n```\n';
  assert.deepEqual(parseTranslations(raw, expected), { a: 'Eins' });
});

test('parseTranslations accepts a bare id map', () => {
  assert.deepEqual(parseTranslations('{"a":"Eins"}', expected), { a: 'Eins' });
});

test('parseTranslations drops ids nobody asked for and empty values', () => {
  const out = parseTranslations('{"translations":{"a":"Eins","zz":"Nope","b":""}}', expected);
  assert.deepEqual(out, { a: 'Eins' });
});

test('parseTranslations throws on unusable output so the retry can fire', () => {
  assert.throws(() => parseTranslations('I cannot do that', expected));
});

/* ------------------------------------------------------------------ */
/* Glossary                                                            */
/* ------------------------------------------------------------------ */

test('parseGlossary reads one term per line', () => {
  const entries = parseGlossary('Streak = TR: Seri, DE: Serie\nHabit = TR: Alışkanlık');
  assert.deepEqual(entries, [
    { term: 'Streak', byLang: { TR: 'Seri', DE: 'Serie' } },
    { term: 'Habit', byLang: { TR: 'Alışkanlık' } },
  ]);
});

test('parseGlossary skips comments and half-typed lines', () => {
  const entries = parseGlossary('# a note\n\nStreak\nStreak =\n= TR: Seri\nStreak = tr: Seri');
  assert.deepEqual(entries, [{ term: 'Streak', byLang: { TR: 'Seri' } }]);
});

test('glossaryFor only surfaces the target language', () => {
  const entries = parseGlossary('Streak = TR: Seri, DE: Serie');
  assert.deepEqual(glossaryFor(entries, TR), ['"Streak" -> "Seri"']);
  assert.deepEqual(glossaryFor(entries, langByCode('FR')), []);
  assert.deepEqual(glossaryFor(undefined, TR), []);
});

/* ------------------------------------------------------------------ */
/* Prompts                                                             */
/* ------------------------------------------------------------------ */

test('the system prompt carries the constraints it promises', () => {
  const prompt = buildSystemPrompt(
    EN,
    DE,
    ['HabitFlow'],
    parseGlossary('Streak = DE: Serie'),
    true
  );
  assert.ok(prompt.includes('German'));
  assert.ok(prompt.includes('HabitFlow'));
  assert.ok(prompt.includes('"Streak" -> "Serie"'));
  assert.ok(prompt.includes('maxChars'));
  assert.ok(prompt.includes('STRICT JSON'));
});

test('the system prompt omits sections that do not apply', () => {
  const prompt = buildSystemPrompt(EN, DE, [], [], false);
  assert.ok(!prompt.includes('maxChars'));
  assert.ok(!prompt.includes('Never translate these'));
  assert.ok(!prompt.includes('right-to-left'));
});

test('right-to-left targets get their own instruction', () => {
  assert.ok(buildSystemPrompt(EN, AR, [], [], false).includes('right-to-left'));
});

test('the payload attaches a budget only where one exists', () => {
  const req = { source: EN, target: DE, strings: expected, budgets: { a: 24 } };
  const payload = JSON.parse(buildUserPayload(req, expected));
  assert.deepEqual(payload.strings[0], { id: 'a', text: 'One', maxChars: 24 });
  assert.deepEqual(payload.strings[1], { id: 'b', text: 'Two' });
  assert.equal(payload.targetLanguage, 'de');
});

test('the shorten prompt stays in the target language', () => {
  const prompt = buildShortenPrompt(DE, [], []);
  assert.ok(prompt.includes('ALREADY in German'));
  assert.ok(prompt.includes('maxChars'));
  assert.ok(!prompt.includes('Translate the given UI strings'));
});

/* ------------------------------------------------------------------ */
/* Output quality checks                                               */
/* ------------------------------------------------------------------ */

test('qualityIssues reports placeholders that did not survive', () => {
  const items = [{ id: 'a', text: 'Hi {{name}}', count: 1 }];
  assert.deepEqual(qualityIssues(items, { a: 'Hallo {{name}}' }, []), []);
  const issues = qualityIssues(items, { a: 'Hallo {{ Name }}' }, []);
  assert.equal(issues.length, 1);
  assert.ok(issues[0].includes('{{name}}'));
});

test('qualityIssues reports protected nouns that got translated', () => {
  const items = [{ id: 'a', text: 'Open HabitFlow', count: 1 }];
  const issues = qualityIssues(items, { a: 'Gewohnheitsfluss öffnen' }, ['HabitFlow']);
  assert.equal(issues.length, 1);
  assert.ok(issues[0].includes('HabitFlow'));
});

test('qualityIssues ignores strings that came back missing', () => {
  const items = [{ id: 'a', text: 'Hi {{name}}', count: 1 }];
  assert.deepEqual(qualityIssues(items, {}, []), []);
});

/* ------------------------------------------------------------------ */
/* OpenAI parameter compatibility                                      */
/* ------------------------------------------------------------------ */

test('reasoning models are known to reject a custom temperature', () => {
  assert.equal(modelRejectsTemperature('gpt-4o-mini'), false);
  assert.equal(modelRejectsTemperature('gpt-4.1'), false);
  assert.equal(modelRejectsTemperature('o3'), true);
  assert.equal(modelRejectsTemperature('o4-mini'), true);
  assert.equal(modelRejectsTemperature('gpt-5'), true);
  assert.equal(modelRejectsTemperature('  gpt-5-mini '), true);
});

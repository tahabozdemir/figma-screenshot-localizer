/**
 * The language table.
 *
 * Adding a language is one object in `LANGUAGES` — including whatever code the
 * individual engines insist on, which lives on the language itself rather than
 * in three separate lookup maps somewhere else in the file.
 */

import type { LanguageDef } from './types';

export const LANGUAGES: LanguageDef[] = [
  { code: 'EN', tag: 'en', name: 'English', rtl: false, script: 'latin', engine: { deeplTarget: 'EN-US' } },
  { code: 'DE', tag: 'de', name: 'German', rtl: false, script: 'latin' },
  { code: 'FR', tag: 'fr', name: 'French', rtl: false, script: 'latin' },
  { code: 'ES', tag: 'es', name: 'Spanish', rtl: false, script: 'latin' },
  { code: 'IT', tag: 'it', name: 'Italian', rtl: false, script: 'latin' },
  { code: 'PT', tag: 'pt', name: 'Portuguese', rtl: false, script: 'latin', engine: { google: 'pt', deeplTarget: 'PT-PT' } },
  { code: 'TR', tag: 'tr', name: 'Turkish', rtl: false, script: 'latin' },
  { code: 'NL', tag: 'nl', name: 'Dutch', rtl: false, script: 'latin' },
  { code: 'PL', tag: 'pl', name: 'Polish', rtl: false, script: 'latin' },
  { code: 'CS', tag: 'cs', name: 'Czech', rtl: false, script: 'latin' },
  { code: 'DA', tag: 'da', name: 'Danish', rtl: false, script: 'latin' },
  { code: 'SV', tag: 'sv', name: 'Swedish', rtl: false, script: 'latin' },
  {
    code: 'NO',
    tag: 'nb',
    name: 'Norwegian',
    rtl: false,
    script: 'latin',
    engine: { google: 'no', deeplSource: 'NB', deeplTarget: 'NB' },
  },
  { code: 'FI', tag: 'fi', name: 'Finnish', rtl: false, script: 'latin' },
  { code: 'RU', tag: 'ru', name: 'Russian', rtl: false, script: 'cyrillic' },
  { code: 'UK', tag: 'uk', name: 'Ukrainian', rtl: false, script: 'cyrillic' },
  { code: 'JA', tag: 'ja', name: 'Japanese', rtl: false, script: 'cjk' },
  { code: 'KO', tag: 'ko', name: 'Korean', rtl: false, script: 'cjk' },
  {
    code: 'ZH-CN',
    tag: 'zh-Hans',
    name: 'Chinese Simplified',
    rtl: false,
    script: 'cjk',
    engine: { google: 'zh-CN', deeplSource: 'ZH', deeplTarget: 'ZH-HANS' },
  },
  {
    code: 'ZH-TW',
    tag: 'zh-Hant',
    name: 'Chinese Traditional',
    rtl: false,
    script: 'cjk',
    engine: { google: 'zh-TW', deeplSource: 'ZH', deeplTarget: 'ZH-HANT' },
  },
  { code: 'AR', tag: 'ar', name: 'Arabic', rtl: true, script: 'arabic' },
];

const BY_CODE: Record<string, LanguageDef> = {};
for (const l of LANGUAGES) BY_CODE[l.code] = l;

export function langByCode(code: string): LanguageDef | undefined {
  return BY_CODE[code.toUpperCase()];
}

/* ------------------------------------------------------------------ */
/* Engine codes                                                        */
/* ------------------------------------------------------------------ */

/** Google's own code; falls back to the BCP-47 tag. */
export function googleCode(lang: LanguageDef): string {
  return (lang.engine && lang.engine.google) || lang.tag;
}

/** DeepL target codes: regional variants are only valid as a target. */
export function deeplTarget(lang: LanguageDef): string {
  return (lang.engine && lang.engine.deeplTarget) || lang.code;
}

/** DeepL source codes are always the plain language, never a variant. */
export function deeplSource(lang: LanguageDef): string {
  return (lang.engine && lang.engine.deeplSource) || lang.code;
}

/* ------------------------------------------------------------------ */
/* Frame naming                                                        */
/* ------------------------------------------------------------------ */

/** All known codes, longest first, so "ZH-CN" is stripped before "ZH". */
export const CODES_BY_LENGTH: string[] = LANGUAGES.map((l) => l.code).sort(
  (a, b) => b.length - a.length
);

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * "01_Hero_EN" -> "01_Hero", "[EN] Hero" -> "Hero".
 * Only strips codes we actually know about, so "Hero_V2" survives untouched.
 */
export function stripLanguageTag(name: string): string {
  let out = name.trim();
  for (const code of CODES_BY_LENGTH) {
    const bracket = new RegExp('^\\[' + escapeRe(code) + '\\]\\s*', 'i');
    if (bracket.test(out)) {
      out = out.replace(bracket, '');
      break;
    }
  }
  for (const code of CODES_BY_LENGTH) {
    const suffix = new RegExp('[_\\-\\s]' + escapeRe(code) + '$', 'i');
    if (suffix.test(out)) {
      out = out.replace(suffix, '');
      break;
    }
  }
  return out.trim() || name.trim();
}

export function localizedName(originalName: string, code: string, suffixNaming: boolean): string {
  const base = stripLanguageTag(originalName);
  return suffixNaming ? base + '_' + code : '[' + code + '] ' + base;
}

export const SCRIPT_LABEL: Record<LanguageDef['script'], string> = {
  latin: 'Latin',
  cyrillic: 'Cyrillic',
  cjk: 'CJK',
  arabic: 'Arabic',
};

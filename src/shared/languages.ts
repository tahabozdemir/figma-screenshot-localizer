/**
 * The language table.
 *
 * Adding a language is one object in `LANGUAGES` — including whatever code the
 * individual engines insist on, which lives on the language itself rather than
 * in three separate lookup maps somewhere else in the file.
 */

import type { FolderScheme, LanguageDef, NamingOptions } from './types';

export const LANGUAGES: LanguageDef[] = [
  {
    code: 'EN',
    tag: 'en',
    name: 'English',
    rtl: false,
    script: 'latin',
    stores: { appStore: 'en-US', play: 'en-US' },
    engine: { deeplTarget: 'EN-US' },
  },
  {
    code: 'EN-GB',
    tag: 'en-GB',
    name: 'English (UK)',
    rtl: false,
    script: 'latin',
    stores: { appStore: 'en-GB', play: 'en-GB' },
    engine: { google: 'en', deeplSource: 'EN', deeplTarget: 'EN-GB' },
  },
  {
    code: 'EN-AU',
    tag: 'en-AU',
    name: 'English (Australia)',
    rtl: false,
    script: 'latin',
    stores: { appStore: 'en-AU', play: 'en-AU' },
    // DeepL has no Australian variant; British is the closer of the two it has.
    engine: { google: 'en', deeplSource: 'EN', deeplTarget: 'EN-GB' },
  },
  {
    code: 'EN-CA',
    tag: 'en-CA',
    name: 'English (Canada)',
    rtl: false,
    script: 'latin',
    stores: { appStore: 'en-CA', play: 'en-CA' },
    // Canadian spelling follows British for -our/-re, so does this default.
    engine: { google: 'en', deeplSource: 'EN', deeplTarget: 'EN-GB' },
  },
  {
    code: 'DE',
    tag: 'de',
    name: 'German',
    rtl: false,
    script: 'latin',
    stores: { appStore: 'de-DE', play: 'de-DE' },
  },
  {
    code: 'FR',
    tag: 'fr',
    name: 'French',
    rtl: false,
    script: 'latin',
    stores: { appStore: 'fr-FR', play: 'fr-FR' },
  },
  {
    code: 'FR-CA',
    tag: 'fr-CA',
    name: 'French (Canada)',
    rtl: false,
    script: 'latin',
    stores: { appStore: 'fr-CA', play: 'fr-CA' },
    engine: { google: 'fr', deeplSource: 'FR', deeplTarget: 'FR' },
  },
  {
    code: 'ES',
    tag: 'es',
    name: 'Spanish',
    rtl: false,
    script: 'latin',
    stores: { appStore: 'es-ES', play: 'es-ES' },
  },
  {
    code: 'ES-MX',
    tag: 'es-MX',
    name: 'Spanish (Mexico)',
    rtl: false,
    script: 'latin',
    // Play has no Mexican locale — es-419 is where Latin America is filed.
    stores: { appStore: 'es-MX', play: 'es-419' },
    engine: { google: 'es', deeplSource: 'ES', deeplTarget: 'ES' },
  },
  {
    code: 'IT',
    tag: 'it',
    name: 'Italian',
    rtl: false,
    script: 'latin',
    stores: { play: 'it-IT' },
  },
  {
    code: 'PT',
    tag: 'pt',
    name: 'Portuguese',
    rtl: false,
    script: 'latin',
    stores: { appStore: 'pt-PT', play: 'pt-PT' },
    engine: { google: 'pt', deeplTarget: 'PT-PT' },
  },
  {
    code: 'PT-BR',
    tag: 'pt-BR',
    name: 'Portuguese (Brazil)',
    rtl: false,
    script: 'latin',
    stores: { appStore: 'pt-BR', play: 'pt-BR' },
    // Google's plain "pt" is already Brazilian.
    engine: { google: 'pt', deeplSource: 'PT', deeplTarget: 'PT-BR' },
  },
  {
    code: 'TR',
    tag: 'tr',
    name: 'Turkish',
    rtl: false,
    script: 'latin',
    stores: { play: 'tr-TR' },
  },
  {
    code: 'NL',
    tag: 'nl',
    name: 'Dutch',
    rtl: false,
    script: 'latin',
    stores: { appStore: 'nl-NL', play: 'nl-NL' },
  },
  { code: 'PL', tag: 'pl', name: 'Polish', rtl: false, script: 'latin', stores: { play: 'pl-PL' } },
  { code: 'CS', tag: 'cs', name: 'Czech', rtl: false, script: 'latin', stores: { play: 'cs-CZ' } },
  { code: 'DA', tag: 'da', name: 'Danish', rtl: false, script: 'latin', stores: { play: 'da-DK' } },
  {
    code: 'SV',
    tag: 'sv',
    name: 'Swedish',
    rtl: false,
    script: 'latin',
    stores: { play: 'sv-SE' },
  },
  {
    code: 'NO',
    tag: 'nb',
    name: 'Norwegian',
    rtl: false,
    script: 'latin',
    stores: { appStore: 'no', play: 'no-NO' },
    engine: { google: 'no', deeplSource: 'NB', deeplTarget: 'NB' },
  },
  {
    code: 'FI',
    tag: 'fi',
    name: 'Finnish',
    rtl: false,
    script: 'latin',
    stores: { play: 'fi-FI' },
  },
  { code: 'ID', tag: 'id', name: 'Indonesian', rtl: false, script: 'latin' },
  { code: 'MS', tag: 'ms', name: 'Malay', rtl: false, script: 'latin' },
  { code: 'VI', tag: 'vi', name: 'Vietnamese', rtl: false, script: 'latin' },
  {
    code: 'RU',
    tag: 'ru',
    name: 'Russian',
    rtl: false,
    script: 'cyrillic',
    stores: { play: 'ru-RU' },
  },
  { code: 'UK', tag: 'uk', name: 'Ukrainian', rtl: false, script: 'cyrillic' },
  { code: 'JA', tag: 'ja', name: 'Japanese', rtl: false, script: 'cjk', stores: { play: 'ja-JP' } },
  { code: 'KO', tag: 'ko', name: 'Korean', rtl: false, script: 'cjk', stores: { play: 'ko-KR' } },
  {
    code: 'ZH-CN',
    tag: 'zh-Hans',
    name: 'Chinese Simplified',
    rtl: false,
    script: 'cjk',
    stores: { play: 'zh-CN' },
    engine: { google: 'zh-CN', deeplSource: 'ZH', deeplTarget: 'ZH-HANS' },
  },
  {
    code: 'ZH-TW',
    tag: 'zh-Hant',
    name: 'Chinese Traditional',
    rtl: false,
    script: 'cjk',
    stores: { play: 'zh-TW' },
    engine: { google: 'zh-TW', deeplSource: 'ZH', deeplTarget: 'ZH-HANT' },
  },
  { code: 'TH', tag: 'th', name: 'Thai', rtl: false, script: 'thai' },
  {
    code: 'AR',
    tag: 'ar',
    name: 'Arabic',
    rtl: true,
    script: 'arabic',
    stores: { appStore: 'ar-SA' },
  },
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
/* Store locales                                                       */
/* ------------------------------------------------------------------ */

/**
 * The locale a store files this language's screenshots under — "ar-SA" on the
 * App Store, plain "ar" on Google Play. Most are the BCP-47 tag already; only
 * the ones that differ carry a `stores` override.
 */
export function storeLocale(lang: LanguageDef, scheme: FolderScheme): string {
  const stores = lang.stores;
  if (scheme === 'appStore') return (stores && stores.appStore) || lang.tag;
  if (scheme === 'play') return (stores && stores.play) || lang.tag;
  return lang.tag;
}

/**
 * The schemes offered in the panel, in menu order. `example` is what the AR
 * row of each looks like — the one language where all three differ.
 */
export const FOLDER_SCHEMES: Array<{ id: FolderScheme; label: string; example: string }> = [
  { id: 'none', label: 'No folders — tag the frame names', example: 'Hero_AR' },
  { id: 'appStore', label: 'App Store Connect', example: 'ar-SA/Hero' },
  { id: 'play', label: 'Google Play Console', example: 'ar/Hero' },
  { id: 'tag', label: 'Language tag (BCP-47)', example: 'ar/Hero' },
];

/* ------------------------------------------------------------------ */
/* Frame naming                                                        */
/* ------------------------------------------------------------------ */

/** All known codes, longest first, so "ZH-CN" is stripped before "ZH". */
export const CODES_BY_LENGTH: string[] = LANGUAGES.map((l) => l.code).sort(
  (a, b) => b.length - a.length
);

/**
 * Every locale any scheme can produce, so that re-running with a different
 * store replaces the folder instead of nesting one inside the other.
 */
export const STORE_LOCALES: string[] = (() => {
  const seen: Record<string, true> = {};
  const out: string[] = [];
  for (const lang of LANGUAGES) {
    for (const scheme of ['appStore', 'play', 'tag'] as FolderScheme[]) {
      const locale = storeLocale(lang, scheme);
      if (seen[locale.toLowerCase()]) continue;
      seen[locale.toLowerCase()] = true;
      out.push(locale);
    }
  }
  return out;
})();

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * "01_Hero_EN" -> "01_Hero", "[EN] Hero" -> "Hero", "ar-SA/01_Hero" -> "01_Hero".
 * Only strips codes we actually know about, so "Hero_V2" and a hand-made
 * "Screens/01 Hero" both survive untouched.
 */
export function stripLanguageTag(name: string): string {
  let out = name.trim();
  for (const locale of STORE_LOCALES) {
    const folder = new RegExp('^' + escapeRe(locale) + '/', 'i');
    if (folder.test(out)) {
      out = out.replace(folder, '').trim();
      break;
    }
  }
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

/**
 * The name a clone gets. `exportFolders` wins over `suffixNaming`: a frame
 * named "ar-SA/01_Hero" is what makes Figma's export write one folder per
 * store locale, and a language tag on top of that would only be noise.
 */
export function localizedName(
  originalName: string,
  lang: LanguageDef,
  options: NamingOptions
): string {
  const base = stripLanguageTag(originalName);
  if (options.exportFolders !== 'none') {
    return storeLocale(lang, options.exportFolders) + '/' + base;
  }
  return options.suffixNaming ? base + '_' + lang.code : '[' + lang.code + '] ' + base;
}

export const SCRIPT_LABEL: Record<LanguageDef['script'], string> = {
  latin: 'Latin',
  cyrillic: 'Cyrillic',
  cjk: 'CJK',
  arabic: 'Arabic',
  thai: 'Thai',
};

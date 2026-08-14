import { parseGlossary } from '../../providers/prompt';
import { normalizeFolders } from '../../shared/defaults';
import { FOLDER_SCHEMES, langByCode, storeLocale } from '../../shared/languages';
import type { FolderScheme, GenerateOptions, GlossaryEntry } from '../../shared/types';
import { $, clear, el } from '../dom';
import { persistSettings, state } from '../state';

/** DOM id -> the option it drives. The one place the two are related. */
const OPTION_FIELDS: Array<[string, keyof GenerateOptions]> = [
  ['opt-group', 'groupPerLanguage'],
  ['opt-keep', 'keepOriginals'],
  ['opt-adjust', 'autoAdjust'],
  ['opt-overflow', 'detectOverflow'],
  ['opt-format', 'preserveFormatting'],
  ['opt-suffix', 'suffixNaming'],
  ['opt-update', 'updateExisting'],
  ['opt-fit', 'fitToLayout'],
];

/**
 * What the chosen scheme does to the frames that are actually selected — the
 * two Chinas and Arabic are exactly where the stores disagree, so a static
 * example would be the least useful line to show.
 */
function foldersNote(scheme: FolderScheme): string {
  if (scheme === 'none') {
    return 'Frames keep a flat name; the switch above decides the tag.';
  }
  const targets = state.settings.targets.length ? state.settings.targets : ['EN', 'ZH-CN', 'AR'];
  const sample: string[] = [];
  for (const code of targets) {
    const lang = langByCode(code);
    if (lang && sample.length < 3) sample.push(storeLocale(lang, scheme) + '/');
  }
  return (
    'Frames are named ' +
    sample.join(' ') +
    (targets.length > sample.length ? ' …' : '') +
    ' — select them all and export to get one folder per locale.'
  );
}

function buildFoldersPicker(): void {
  const select = $<HTMLSelectElement>('export-folders');
  clear(select);
  for (const scheme of FOLDER_SCHEMES) {
    select.appendChild(
      el('option', { value: scheme.id, text: scheme.label + ' — ' + scheme.example })
    );
  }
}

export function glossaryList(): GlossaryEntry[] {
  return parseGlossary(state.settings.glossary);
}

export function renderGlossaryState(): void {
  const el = $('glossary-state');
  if (!state.settings.glossary.trim()) {
    el.textContent = '';
    return;
  }
  const entries = glossaryList();
  if (!entries.length) {
    el.textContent = 'No usable line yet — the format is: Streak = TR: Seri, DE: Serie';
    return;
  }
  const unknown: string[] = [];
  for (const entry of entries) {
    for (const code of Object.keys(entry.byLang)) {
      if (!langByCode(code) && unknown.indexOf(code) < 0) unknown.push(code);
    }
  }
  el.textContent =
    entries.length +
    (entries.length === 1 ? ' term' : ' terms') +
    (unknown.length ? ' · unknown language code: ' + unknown.join(', ') : '');
}

export function renderOptions(): void {
  for (const [id, key] of OPTION_FIELDS) {
    $<HTMLInputElement>(id).checked = state.settings.options[key];
  }
  const folders = $<HTMLSelectElement>('export-folders');
  if (!folders.options.length) buildFoldersPicker();
  folders.value = state.settings.exportFolders;
  $('export-folders-note').textContent = foldersNote(state.settings.exportFolders);
  // Folders carry the language themselves — the suffix/prefix switch is moot.
  $<HTMLInputElement>('opt-suffix').disabled = state.settings.exportFolders !== 'none';
  $<HTMLInputElement>('opt-debug').checked = state.settings.debug;
  $<HTMLInputElement>('dnt').value = state.settings.doNotTranslate;
  $<HTMLTextAreaElement>('glossary').value = state.settings.glossary;
  renderGlossaryState();
}

export function mountOptions(): void {
  for (const [id, key] of OPTION_FIELDS) {
    $(id).addEventListener('change', (e) => {
      state.settings.options[key] = (e.target as HTMLInputElement).checked;
      persistSettings();
    });
  }

  buildFoldersPicker();
  $('export-folders').addEventListener('change', (e) => {
    state.settings.exportFolders = normalizeFolders((e.target as HTMLSelectElement).value);
    renderOptions();
    persistSettings();
  });

  $('opt-debug').addEventListener('change', (e) => {
    state.settings.debug = (e.target as HTMLInputElement).checked;
    persistSettings();
  });

  $('dnt').addEventListener('input', (e) => {
    state.settings.doNotTranslate = (e.target as HTMLInputElement).value;
    persistSettings();
  });

  $('glossary').addEventListener('input', (e) => {
    state.settings.glossary = (e.target as HTMLTextAreaElement).value;
    renderGlossaryState();
    persistSettings();
  });
}

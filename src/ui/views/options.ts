import { parseGlossary } from '../../providers/prompt';
import { langByCode } from '../../shared/languages';
import type { GenerateOptions, GlossaryEntry } from '../../shared/types';
import { $ } from '../dom';
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

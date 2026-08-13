import { LANGUAGES } from '../../shared/languages';
import { $, el, replace } from '../dom';
import { persistSettings, state } from '../state';

export interface LanguageHandlers {
  /** The target list or the source language changed. */
  onTargetsChanged: () => void;
}

export function renderSourceLanguages(): void {
  const select = $<HTMLSelectElement>('source-lang');
  replace(
    select,
    LANGUAGES.map((l) => el('option', { value: l.code, text: l.name + ' (' + l.code + ')' }))
  );
  select.value = state.settings.sourceLanguage;
}

function matches(): typeof LANGUAGES {
  const filter = state.filter.trim().toLowerCase();
  if (!filter) return LANGUAGES;
  return LANGUAGES.filter(
    (l) =>
      l.name.toLowerCase().indexOf(filter) >= 0 ||
      l.code.toLowerCase().indexOf(filter) >= 0 ||
      l.tag.toLowerCase().indexOf(filter) >= 0
  );
}

export function renderLanguageList(): void {
  const list = $('lang-list');
  const found = matches();

  if (!found.length) {
    replace(list, [
      el('div', { class: 'empty-state', text: 'No language matches “' + state.filter + '”' }),
    ]);
  } else {
    replace(
      list,
      found.map((l) =>
        el('label', { class: 'lang-row' }, [
          el('input', {
            type: 'checkbox',
            checked: state.settings.targets.indexOf(l.code) >= 0,
            dataset: { lang: l.code },
          }),
          el('span', { text: l.name }),
          l.rtl ? el('span', { class: 'rtl', text: 'RTL' }) : null,
          el('span', { class: 'code', text: l.code }),
        ])
      )
    );
  }

  renderCount();
}

function renderCount(): void {
  $('lang-count').textContent = state.settings.targets.length + ' selected';
}

export function mountLanguages(handlers: LanguageHandlers): void {
  $<HTMLSelectElement>('source-lang').addEventListener('change', (e) => {
    state.settings.sourceLanguage = (e.target as HTMLSelectElement).value;
    handlers.onTargetsChanged();
    persistSettings();
  });

  $<HTMLInputElement>('lang-search').addEventListener('input', (e) => {
    state.filter = (e.target as HTMLInputElement).value;
    renderLanguageList();
  });

  $('lang-list').addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    const code = input.dataset.lang;
    if (!code) return;
    const targets = state.settings.targets;
    const index = targets.indexOf(code);
    if (input.checked && index < 0) targets.push(code);
    if (!input.checked && index >= 0) targets.splice(index, 1);
    renderCount();
    handlers.onTargetsChanged();
    persistSettings();
  });

  $('lang-all').addEventListener('click', () => {
    state.settings.targets = LANGUAGES.map((l) => l.code);
    renderLanguageList();
    handlers.onTargetsChanged();
    persistSettings();
  });

  $('lang-none').addEventListener('click', () => {
    state.settings.targets = [];
    renderLanguageList();
    handlers.onTargetsChanged();
    persistSettings();
  });
}

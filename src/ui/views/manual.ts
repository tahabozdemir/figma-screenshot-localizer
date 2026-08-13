/**
 * The manual translation editor: one collapsible block per target language,
 * with the unique source strings and a textarea each.
 */

import { langByCode } from '../../shared/languages';
import type { LanguageDef } from '../../shared/types';
import { $, clear, el, replace } from '../dom';
import { filledCount, persistManual, state } from '../state';

function signature(): string {
  const ids: string[] = [];
  for (const item of state.strings) ids.push(item.id);
  return (
    state.settings.targets.join(',') + '|' + state.settings.sourceLanguage + '|' + ids.join(',')
  );
}

function targetLanguages(): LanguageDef[] {
  const out: LanguageDef[] = [];
  for (const code of state.settings.targets) {
    const lang = langByCode(code);
    if (lang && lang.code !== state.settings.sourceLanguage) out.push(lang);
  }
  return out;
}

export function updateFillState(code: string): void {
  const el2 = document.querySelector('[data-fill="' + code + '"]');
  if (el2) el2.textContent = filledCount(code) + ' / ' + state.strings.length + ' filled';
}

export function renderStringCount(): void {
  const counter = document.getElementById('string-count');
  if (counter) counter.textContent = String(state.strings.length);
}

export function renderManualEditor(): void {
  const host = document.getElementById('manual-editor');
  if (!host) return;
  renderStringCount();

  const targets = targetLanguages();

  if (!targets.length) {
    state.manualSignature = '';
    replace(host, [
      el('p', { class: 'note', text: 'Pick at least one target language to enter translations.' }),
    ]);
    return;
  }
  if (!state.strings.length) {
    state.manualSignature = '';
    replace(host, [
      el('p', {
        class: 'note',
        text: 'Select frames with text layers, then press “Reload strings”.',
      }),
    ]);
    return;
  }

  // Rebuilding throws away scroll position, focus and every expanded language,
  // so only do it when the editor is actually showing the wrong thing.
  const current = signature();
  if (current === state.manualSignature && host.querySelector('.lang-block')) {
    for (const lang of targets) updateFillState(lang.code);
    return;
  }

  const wasOpen: Record<string, true> = {};
  const blocks = host.querySelectorAll('.lang-block[open]');
  for (let i = 0; i < blocks.length; i++) {
    const code = (blocks[i] as HTMLElement).dataset.code;
    if (code) wasOpen[code] = true;
  }

  state.manualSignature = current;
  clear(host);

  for (const lang of targets) {
    const block = el('details', { class: 'lang-block', dataset: { code: lang.code } }, [
      el('summary', {}, [
        el('span', { text: lang.name }),
        el('span', { class: 'fill-state', dataset: { fill: lang.code } }),
      ]),
    ]);
    host.appendChild(block);

    // Rows are built on first expand: 21 languages × every string is a lot of
    // DOM for a panel most people open two of.
    block.addEventListener('toggle', () => {
      if (block.open && !block.querySelector('.mrows')) buildRows(block, lang.code);
    });
    if (wasOpen[lang.code]) block.open = true;
    updateFillState(lang.code);
  }
}

function buildRows(block: HTMLElement, code: string): void {
  const bag = state.manual[code] || (state.manual[code] = {});
  const rows = el('div', { class: 'mrows' });

  const prefill = el('button', {
    class: 'link',
    text: 'Prefill with source text',
    dataset: { copy: code },
  });
  rows.appendChild(
    el('div', { class: 'row between' }, [
      el('span', { class: 'muted', text: state.strings.length + ' strings' }),
      prefill,
    ])
  );

  const inputs: HTMLTextAreaElement[] = [];
  for (const item of state.strings) {
    const source = el('div', { class: 'src', text: item.text });
    if (item.count > 1) source.appendChild(el('span', { class: 'dup', text: ' ×' + item.count }));

    const input = el('textarea', {
      rows: 2,
      value: bag[item.id] || '',
      placeholder: 'Translation…',
      dataset: { lang: code, id: item.id },
    });
    input.addEventListener('input', () => {
      bag[item.id] = input.value;
      updateFillState(code);
      persistManual();
    });
    inputs.push(input);

    rows.appendChild(el('div', { class: 'mrow' }, [source, input]));
  }

  block.appendChild(rows);

  prefill.addEventListener('click', () => {
    for (const item of state.strings) {
      if (!bag[item.id]) bag[item.id] = item.text;
    }
    for (const input of inputs) {
      const id = input.dataset.id || '';
      input.value = bag[id] || '';
    }
    updateFillState(code);
    persistManual();
  });
}

export function mountManual(handlers: { onReload: () => void }): void {
  // The button lives inside the generated manual panel, so delegate.
  $('mode-panels').addEventListener('click', (e) => {
    if ((e.target as HTMLElement).id === 'reload-strings') handlers.onReload();
  });
}

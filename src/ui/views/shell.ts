/**
 * The non-form half of the panel: which view is showing, the progress screen,
 * the summary and the warning list.
 */

import type { GenerateSummary } from '../../shared/types';
import { formatWarning } from '../../shared/warnings';
import { $, el, replace, setHidden } from '../dom';
import { state } from '../state';

export type ViewName = 'main' | 'progress' | 'done' | 'warnings';

const VIEWS: ViewName[] = ['main', 'progress', 'done', 'warnings'];

export function showView(name: ViewName): void {
  for (const view of VIEWS) {
    $('view-' + view).classList.toggle('active', view === name);
  }
  setHidden($('footer'), name !== 'main');
}

export function showFormError(message: string | null): void {
  const el2 = $('form-error');
  el2.textContent = message || '';
  setHidden(el2, !message);
}

export function setProgress(label: string, detail: string, ratio: number): void {
  $('progress-label').textContent = label;
  $('progress-detail').textContent = detail;
  const clamped = Math.round(Math.min(1, Math.max(0, ratio)) * 100);
  $('progress-bar').style.width = clamped + '%';
}

export function setProgressLabel(label: string): void {
  $('progress-label').textContent = label;
}

export function renderDone(summary: GenerateSummary): void {
  $('done-title').textContent =
    summary.framesCreated > 0 ? 'Localization complete' : 'Nothing was created';

  const stat = (value: number, label: string, extra?: Node | null) =>
    el('li', {}, [el('b', { text: String(value) }), ' ' + label, extra || null]);

  replace($('done-stats'), [
    stat(summary.sourceFrames, 'source frames'),
    stat(summary.languages, 'languages'),
    stat(summary.framesCreated, 'localized frames created'),
    stat(
      summary.layersTranslated,
      'text layers written',
      summary.cacheHits
        ? el('span', {}, [
            ' · ',
            el('b', { text: String(summary.cacheHits) }),
            ' reused from cache',
          ])
        : null
    ),
    summary.shortened ? stat(summary.shortened, 'shortened by the model to fit') : null,
    stat(summary.warnings, 'warnings'),
  ]);

  const warnButton = $<HTMLButtonElement>('done-warnings');
  warnButton.textContent = 'View warnings (' + state.warnings.length + ')';
  warnButton.disabled = state.warnings.length === 0;
}

export function renderWarnings(): void {
  const list = $('warn-list');
  const items = state.warnings;

  $('warn-title').textContent = items.length + (items.length === 1 ? ' warning' : ' warnings');

  if (!items.length) {
    replace(list, [
      el('div', {
        class: 'empty-state',
        text: 'Nothing to report — every layer was localized cleanly.',
      }),
    ]);
    return;
  }

  replace(
    list,
    items.map((w, index) =>
      el('div', { class: 'warn-item', dataset: { index: String(index) } }, [
        el('div', { class: 'warn-meta' }, [
          el('span', { class: 'sev ' + w.severity, text: w.severity }),
          el('span', { text: w.language + ' / ' + w.frame }),
          el('span', { class: 'warn-layer', text: w.layer }),
        ]),
        el('div', { class: 'warn-problem', text: formatWarning(w.detail) }),
      ])
    )
  );
}

import { $, el, replace } from '../dom';
import { state } from '../state';

export function renderSelection(): void {
  const summary = $('selection-summary');
  const list = $('frame-list');

  if (!state.frames.length) {
    summary.textContent = 'No frames selected';
    summary.classList.add('empty');
    replace(list, []);
    return;
  }

  summary.classList.remove('empty');
  summary.textContent =
    state.frames.length +
    (state.frames.length === 1 ? ' frame · ' : ' frames · ') +
    state.textCount +
    (state.textCount === 1 ? ' text layer' : ' text layers');

  replace(
    list,
    state.frames.map((frame) =>
      el('span', { class: 'chip', title: frame.name }, [
        el('b', { text: frame.name }),
        ' ',
        el('span', { class: 'muted', text: String(frame.textCount) }),
      ])
    )
  );
}

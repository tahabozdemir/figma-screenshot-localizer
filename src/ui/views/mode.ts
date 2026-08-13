/**
 * The mode picker and every provider's settings panel — all of it generated
 * from `providers/registry.ts`.
 *
 * There is no per-provider markup in ui.html and no per-provider branch here:
 * the option list, the optgroups, the credential inputs, which of them is a
 * password field and what the privacy note says are all read from the
 * descriptors. Adding a provider adds its panel for free.
 */

import {
  GROUP_LABEL,
  PROVIDER_LIST,
  fieldValue,
  getProvider,
  type ProviderDescriptor,
  type ProviderField,
  type ProviderGroup,
} from '../../providers/registry';
import type { TranslationMode } from '../../shared/types';
import { $, clear, el, setHidden } from '../dom';
import { persistSecrets, persistSecretsSoon, persistSettings, state } from '../state';

export interface ModeHandlers {
  onModeChanged: () => void;
  /** A credential changed — any "enter your key" error may now be stale. */
  onCredentialChanged: () => void;
}

function fieldId(descriptor: ProviderDescriptor, field: ProviderField): string {
  return 'field-' + descriptor.id + '-' + field.id;
}

function buildField(descriptor: ProviderDescriptor, field: ProviderField): HTMLElement {
  const input = el('input', {
    id: fieldId(descriptor, field),
    type: field.type,
    placeholder: field.placeholder,
    autocomplete: 'off',
    spellcheck: false,
    dataset: { provider: descriptor.id, field: field.id },
  });
  return el('div', { class: 'row' }, [
    el('label', { class: 'field' }, [el('span', { text: field.label }), input]),
  ]);
}

/** The manual editor is not credential-driven, so it brings its own body. */
function buildManualBody(): HTMLElement[] {
  return [
    el('div', { class: 'row between' }, [
      el('span', { class: 'muted' }, [
        el('b', { id: 'string-count', text: '0' }),
        ' unique strings in the selection',
      ]),
      el('button', { class: 'link', id: 'reload-strings', text: 'Reload strings' }),
    ]),
    el('div', { id: 'manual-editor' }),
  ];
}

export function buildModePicker(): void {
  const select = $<HTMLSelectElement>('mode');
  clear(select);

  let group: ProviderGroup | null = null;
  let container: HTMLElement = select;
  for (const descriptor of PROVIDER_LIST) {
    const option = el('option', { value: descriptor.id, text: descriptor.optionLabel });
    if (descriptor.group === 'manual') {
      select.appendChild(option);
      continue;
    }
    if (descriptor.group !== group) {
      group = descriptor.group;
      const optgroup = el('optgroup');
      optgroup.label = GROUP_LABEL[group];
      select.appendChild(optgroup);
      container = optgroup;
    }
    container.appendChild(option);
  }

  const panels = $('mode-panels');
  clear(panels);
  for (const descriptor of PROVIDER_LIST) {
    const body: HTMLElement[] = descriptor.fields.map((field) => buildField(descriptor, field));
    if (descriptor.id === 'manual') body.push(...buildManualBody());
    if (descriptor.note) body.push(el('p', { class: 'note', text: descriptor.note }));
    panels.appendChild(
      el('div', { class: 'panel hidden', dataset: { panel: descriptor.id } }, body)
    );
  }
}

/** Pushes stored values into the generated inputs. */
export function renderProviderFields(): void {
  for (const descriptor of PROVIDER_LIST) {
    for (const field of descriptor.fields) {
      const input = document.getElementById(fieldId(descriptor, field)) as HTMLInputElement | null;
      if (input) input.value = fieldValue(field, state);
    }
  }
}

export function renderMode(): void {
  const mode = state.settings.mode;
  $<HTMLSelectElement>('mode').value = mode;

  const panels = $('mode-panels').children;
  for (let i = 0; i < panels.length; i++) {
    const panel = panels[i] as HTMLElement;
    setHidden(panel, panel.dataset.panel !== mode);
  }

  const descriptor = getProvider(mode);
  const note = $('privacy-note');
  setHidden(note, mode === 'manual');
  note.textContent = descriptor.fields.some((f) => f.target.scope === 'secret')
    ? 'Local-only plugin. Your API key is stored in Figma client storage and is sent only to the provider you select.'
    : 'Local-only plugin. No key is stored for this mode; only the text strings leave Figma.';
}

export function mountMode(handlers: ModeHandlers): void {
  $('mode').addEventListener('change', (e) => {
    state.settings.mode = (e.target as HTMLSelectElement).value as TranslationMode;
    renderMode();
    handlers.onModeChanged();
    persistSettings();
  });

  /* One delegated listener for every generated field. `input` keeps the state
     live so validation reacts as you type; `change` is the commit that writes
     a secret to storage. */
  const panels = $('mode-panels');

  const apply = (target: HTMLInputElement): ProviderField | null => {
    const providerId = target.dataset.provider as TranslationMode | undefined;
    const fieldKey = target.dataset.field;
    if (!providerId || !fieldKey) return null;
    const field = getProvider(providerId).fields.filter((f) => f.id === fieldKey)[0];
    if (!field) return null;
    if (field.target.scope === 'secret') state.secrets[field.target.key] = target.value;
    else state.settings[field.target.key] = target.value;
    return field;
  };

  panels.addEventListener('input', (e) => {
    const field = apply(e.target as HTMLInputElement);
    if (!field) return;
    if (field.target.scope === 'setting') persistSettings();
    else persistSecretsSoon();
    if (field.credential) handlers.onCredentialChanged();
  });

  panels.addEventListener('change', (e) => {
    const field = apply(e.target as HTMLInputElement);
    if (field && field.target.scope === 'secret') persistSecrets();
  });

  // A key typed and left without blurring must still survive a panel close.
  window.addEventListener('beforeunload', () => persistSecrets());
}

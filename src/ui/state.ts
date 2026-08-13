/**
 * Panel state and everything that persists it.
 *
 * Settings are saved on a debounce because they change on every keystroke.
 * Secrets are not: they are written when a field is committed, so typing an
 * API key no longer pushes it across the postMessage boundary and back to disk
 * once per character.
 */

import { DEFAULT_SECRETS, DEFAULT_SETTINGS } from '../shared/defaults';
import type { UiToPlugin } from '../shared/messages';
import type {
  FrameSummary,
  ManualTable,
  PersistedSettings,
  Secrets,
  SourceString,
} from '../shared/types';
import type { Warning } from '../shared/warnings';

export interface UiState {
  frames: FrameSummary[];
  textCount: number;
  strings: SourceString[];
  settings: PersistedSettings;
  secrets: Secrets;
  /** manual[languageCode][stringId] = translation, persisted via the sandbox. */
  manual: ManualTable;
  warnings: Warning[];
  running: boolean;
  cancelRequested: boolean;
  /** Aborts in-flight provider requests the moment Cancel is pressed. */
  abort: AbortController | null;
  filter: string;
  /** Signature of the strings the manual editor was last built for. */
  manualSignature: string;
}

export const state: UiState = {
  frames: [],
  textCount: 0,
  strings: [],
  settings: { ...DEFAULT_SETTINGS, options: { ...DEFAULT_SETTINGS.options } },
  secrets: { ...DEFAULT_SECRETS },
  manual: {},
  warnings: [],
  running: false,
  cancelRequested: false,
  abort: null,
  filter: '',
  manualSignature: '',
};

/**
 * Figma requires `'*'`: the parent frame's origin is not knowable from inside
 * the iframe, and the sandbox is the only listener on the other end.
 */
export function send(msg: UiToPlugin): void {
  window.parent.postMessage({ pluginMessage: msg }, '*');
}

function debounce(fn: () => void, ms: number): () => void {
  let timer = 0;
  return () => {
    clearTimeout(timer);
    timer = window.setTimeout(fn, ms);
  };
}

export const persistSettings = debounce(() => {
  send({ type: 'save-settings', settings: state.settings });
}, 400);

/** Called on commit (blur / Enter) — see the note at the top of this file. */
export function persistSecrets(): void {
  send({ type: 'save-secrets', secrets: state.secrets });
}

/**
 * Backstop for a key that is typed and never committed.
 *
 * `change` covers blur and Enter, and closing the plugin from a button blurs
 * the field first — but closing the window outright does not, and a plugin
 * iframe cannot rely on `beforeunload` firing. A slow debounce keeps the
 * durability the old save-on-every-keystroke had without the write storm.
 */
export const persistSecretsSoon = debounce(() => {
  send({ type: 'save-secrets', secrets: state.secrets });
}, 1500);

export const persistManual = debounce(() => {
  send({ type: 'save-manual', manual: state.manual });
}, 600);

export function filledCount(code: string): number {
  const bag = state.manual[code] || {};
  let filled = 0;
  for (const item of state.strings) {
    const value = bag[item.id];
    if (typeof value === 'string' && value.trim().length) filled++;
  }
  return filled;
}

export function doNotTranslateList(): string[] {
  return state.settings.doNotTranslate
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

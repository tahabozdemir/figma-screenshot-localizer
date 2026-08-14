/**
 * Starting a run, and answering the sandbox when it asks for translations.
 *
 * The provider is built from its descriptor, so this file names no provider at
 * all — which is also why the cache bucket and the capability flags travel to
 * the sandbox in the config instead of being re-derived over there.
 */

import { createProvider, getProvider, missingCredential } from '../providers/registry';
import type { PluginToUi } from '../shared/messages';
import type { GenerateConfig } from '../shared/types';
import { $ } from './dom';
import { doNotTranslateList, filledCount, send, state } from './state';
import { httpRequest } from './transport';
import { glossaryList } from './views/options';
import { setProgress, setProgressLabel, showFormError, showView } from './views/shell';

export function validate(): string | null {
  if (!state.frames.length) {
    return 'Select at least one frame in Figma, then press “Refresh selection”.';
  }
  if (!state.textCount) return 'The selected frames contain no text layers.';
  if (!state.settings.targets.length) return 'Select at least one target language.';

  const targets = state.settings.targets.filter((c) => c !== state.settings.sourceLanguage);
  if (!targets.length) {
    return 'Every selected language is the source language — nothing would be translated.';
  }

  const descriptor = getProvider(state.settings.mode);
  if (missingCredential(descriptor, state)) {
    return 'Enter your ' + descriptor.label + ' key, or switch to another mode.';
  }
  if (descriptor.validate) {
    return descriptor.validate({ targets, filled: filledCount });
  }
  return null;
}

export function startGeneration(): void {
  const error = validate();
  showFormError(error);
  if (error) return;

  const descriptor = getProvider(state.settings.mode);
  const config: GenerateConfig = {
    sourceLanguage: state.settings.sourceLanguage,
    targets: state.settings.targets.slice(),
    mode: state.settings.mode,
    options: state.settings.options,
    exportFolders: state.settings.exportFolders,
    doNotTranslate: doNotTranslateList(),
    cacheKey: descriptor.cacheKey(state),
    capabilities: descriptor.capabilities,
  };

  state.running = true;
  state.cancelRequested = false;
  state.abort = typeof AbortController === 'function' ? new AbortController() : null;
  state.warnings = [];
  $<HTMLButtonElement>('generate').disabled = true;
  $<HTMLButtonElement>('cancel').disabled = false;
  setProgress('Preparing…', '', 0);
  showView('progress');
  send({ type: 'generate', config });
}

export function cancelGeneration(): void {
  state.cancelRequested = true;
  if (state.abort) state.abort.abort();
  $<HTMLButtonElement>('cancel').disabled = true;
  setProgressLabel('Cancelling…');
  send({ type: 'cancel' });
}

type TranslateRequest = Extract<PluginToUi, { type: 'translate-request' }>;

export async function handleTranslateRequest(msg: TranslateRequest): Promise<void> {
  const provider = createProvider(state.settings.mode, { ...state, transport: httpRequest });

  const label = msg.shorten
    ? 'Shortening ' + msg.target.name + ' strings that overflow…'
    : 'Translating into ' + msg.target.name + '…';

  try {
    if (msg.shorten && !provider.shorten) {
      send({
        type: 'translations',
        requestId: msg.requestId,
        translations: {},
        error: provider.name + ' cannot rewrite text; only the AI modes can.',
      });
      return;
    }

    const request = {
      source: msg.source,
      target: msg.target,
      strings: msg.strings,
      budgets: msg.budgets,
    };
    const context = {
      doNotTranslate: doNotTranslateList(),
      glossary: glossaryList(),
      isCancelled: () => state.cancelRequested,
      signal: state.abort ? state.abort.signal : undefined,
      // A prefetch for a later language must not overwrite the label of the
      // language currently being drawn.
      onProgress: msg.quiet
        ? undefined
        : (done: number, total: number) => {
            setProgressLabel(label + (total > 1 ? ' (batch ' + done + '/' + total + ')' : ''));
          },
    };

    const result =
      msg.shorten && provider.shorten
        ? await provider.shorten(request, context)
        : await provider.translate(request, context);

    send({
      type: 'translations',
      requestId: msg.requestId,
      translations: result.translations,
      error: result.error,
      issues: result.issues,
    });
  } catch (e) {
    send({
      type: 'translations',
      requestId: msg.requestId,
      translations: {},
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

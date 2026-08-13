/**
 * UI iframe entry point.
 *
 * Everything happens inside `init()`. Importing this module used to register
 * listeners and paint the panel as a side effect, which meant nothing in the
 * UI could be imported by a test without a DOM appearing first.
 */

import { setDebugLogging, swallow } from '../shared/log';
import { parsePluginToUi } from '../shared/messages';
import { cancelGeneration, handleTranslateRequest, startGeneration } from './generate';
import { $ } from './dom';
import { send, state } from './state';
import { resolveBridgeResponse } from './transport';
import { mountLanguages, renderLanguageList, renderSourceLanguages } from './views/languages';
import { mountManual, renderManualEditor, renderStringCount } from './views/manual';
import { buildModePicker, mountMode, renderMode, renderProviderFields } from './views/mode';
import { mountOptions, renderOptions } from './views/options';
import { renderSelection } from './views/selection';
import { renderDone, renderWarnings, setProgress, showFormError, showView } from './views/shell';

/** The manual editor only exists while its panel is the selected mode. */
function renderManualIfVisible(): void {
  if (state.settings.mode === 'manual') renderManualEditor();
  else renderStringCount();
}

function mountButtons(): void {
  $('refresh').addEventListener('click', () => send({ type: 'refresh-selection' }));
  $('clear-cache').addEventListener('click', () => send({ type: 'clear-cache' }));
  $('generate').addEventListener('click', startGeneration);
  $('cancel').addEventListener('click', cancelGeneration);

  $('done-warnings').addEventListener('click', () => {
    renderWarnings();
    showView('warnings');
  });
  $('done-back').addEventListener('click', () => showView('main'));
  $('done-close').addEventListener('click', () => send({ type: 'close' }));
  $('warn-back').addEventListener('click', () => showView('done'));

  $('warn-list').addEventListener('click', (e) => {
    // The generic, not a cast: closest() returns Element, which has no dataset.
    const item = (e.target as HTMLElement).closest<HTMLElement>('.warn-item');
    if (!item) return;
    const warning = state.warnings[Number(item.dataset.index)];
    if (warning && warning.nodeId) send({ type: 'select-nodes', ids: [warning.nodeId] });
  });
}

/* The sandbox owns the window size, so the grip just reports the size we want
   as the pointer moves. clientX/clientY are already panel-relative. */
function mountResizeGrip(): void {
  const grip = $('resize-grip');
  grip.addEventListener('pointerdown', (e: PointerEvent) => {
    grip.setPointerCapture(e.pointerId);
    const onMove = (move: PointerEvent) => {
      send({
        type: 'resize',
        width: Math.round(move.clientX + 6),
        height: Math.round(move.clientY + 6),
      });
    };
    const onUp = (up: PointerEvent) => {
      try {
        grip.releasePointerCapture(up.pointerId);
      } catch (err) {
        // The pointer was already released.
        swallow('resize grip: releasePointerCapture', err);
      }
      grip.removeEventListener('pointermove', onMove);
      grip.removeEventListener('pointerup', onUp);
    };
    grip.addEventListener('pointermove', onMove);
    grip.addEventListener('pointerup', onUp);
  });
}

function finishRun(): void {
  state.running = false;
  state.abort = null;
  $<HTMLButtonElement>('generate').disabled = false;
}

function mountMessages(): void {
  window.addEventListener('message', (event: MessageEvent) => {
    // MessageEvent.data is `any` and this is a browser context: anything can
    // post here. Narrow to unknown immediately and let the parser decide.
    const envelope = event.data as { pluginMessage?: unknown } | null;
    const raw: unknown = envelope && envelope.pluginMessage;
    const message = parsePluginToUi(raw);
    if (!message) return;

    switch (message.type) {
      case 'settings': {
        state.settings = message.settings;
        state.secrets = message.secrets;
        state.manual = message.manual;
        state.manualSignature = '';
        setDebugLogging(state.settings.debug);
        renderSourceLanguages();
        renderLanguageList();
        renderOptions();
        renderProviderFields();
        renderMode();
        renderManualIfVisible();
        break;
      }

      case 'selection':
        state.frames = message.frames;
        state.textCount = message.textCount;
        renderSelection();
        if (!state.running) showFormError(null);
        break;

      case 'strings':
        state.strings = message.items;
        renderManualIfVisible();
        break;

      case 'translate-request':
        void handleTranslateRequest(message);
        break;

      case 'http-response':
        resolveBridgeResponse(message);
        break;

      case 'progress': {
        const total = Math.max(1, message.langTotal * message.frameTotal);
        const done = Math.max(0, (message.langIndex - 1) * message.frameTotal + message.frameIndex);
        setProgress(
          message.label,
          'Language ' +
            Math.max(1, message.langIndex) +
            ' / ' +
            message.langTotal +
            ' · Frame ' +
            message.frameIndex +
            ' / ' +
            message.frameTotal,
          done / total
        );
        break;
      }

      case 'done':
        finishRun();
        state.warnings = message.warnings;
        renderDone(message.summary);
        showView('done');
        break;

      case 'cancelled':
        finishRun();
        showView('main');
        showFormError('Generation cancelled.');
        break;

      case 'error':
        finishRun();
        showView('main');
        showFormError(message.message);
        break;
    }
  });
}

export function init(): void {
  buildModePicker();

  mountLanguages({ onTargetsChanged: renderManualIfVisible });
  mountMode({
    onModeChanged: renderManualIfVisible,
    onCredentialChanged: () => showFormError(null),
  });
  mountManual({ onReload: () => send({ type: 'scan' }) });
  mountOptions();
  mountButtons();
  mountResizeGrip();
  mountMessages();

  renderSourceLanguages();
  renderLanguageList();
  renderOptions();
  renderProviderFields();
  renderMode();
  renderManualIfVisible();
  renderSelection();

  send({ type: 'ui-ready' });
}

init();

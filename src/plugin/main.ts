/**
 * Plugin sandbox entry point.
 *
 * Deliberately thin: it wires the ports together and routes messages. Anything
 * that could be worth a test — selection scanning, storage, layout, the
 * generation pipeline — lives in a module that takes its dependencies as
 * parameters and can be driven without Figma.
 *
 * Network access is impossible from this thread except through Figma's own
 * proxied fetch, so provider calls are delegated to the UI iframe over a
 * request/response pair (see shared/rpc.ts).
 */

import { CancellationToken } from '../shared/cancellation';
import { setDebugLogging, swallow } from '../shared/log';
import { parseUiToPlugin, type PluginToUi } from '../shared/messages';
import { Rpc, TimeoutError } from '../shared/rpc';
import type { GenerateConfig } from '../shared/types';
import { errorText } from '../shared/util';
import { createDocumentPort, createStoragePort } from './figma-port';
import type { RequestTranslations, TranslationReply } from './localize';
import { proxyHttpRequest } from './net-proxy';
import { generate } from './pipeline';
import { scanSelection } from './selection';
import { Storage } from './storage';

const TRANSLATION_TIMEOUT_MS = 10 * 60 * 1000;
/** Selection scans are cheap individually but fire in bursts while dragging. */
const SELECTION_DEBOUNCE_MS = 120;

/**
 * Hidden layers inside instances are not rendered, so translating them is pure
 * cost — and skipping them makes findAllWithCriteria dramatically faster.
 */
figma.skipInvisibleInstanceChildren = true;

figma.showUI(__html__, { width: 420, height: 680, themeColors: true });

const doc = createDocumentPort();
const storage = new Storage(createStoragePort());
const translations = new Rpc<TranslationReply>('req', TRANSLATION_TIMEOUT_MS);

let running = false;
let token = new CancellationToken();

function post(msg: PluginToUi): void {
  figma.ui.postMessage(msg);
}

const request: RequestTranslations = (source, target, strings, opts) =>
  translations
    .request((requestId) => {
      post({
        type: 'translate-request',
        requestId,
        source,
        target,
        strings,
        budgets: opts && opts.budgets,
        shorten: opts && opts.shorten,
        quiet: opts && opts.quiet,
      });
    })
    .catch((e) => ({
      translations: {},
      error:
        e instanceof TimeoutError
          ? 'Timed out waiting for the translation provider.'
          : errorText(e),
    }));

function sendSelection(): void {
  const scan = scanSelection(doc);
  post({ type: 'selection', frames: scan.frames, textCount: scan.textCount });
  post({ type: 'strings', items: scan.strings });
}

let selectionTimer = 0;
function scheduleSelectionScan(): void {
  clearTimeout(selectionTimer);
  selectionTimer = setTimeout(sendSelection, SELECTION_DEBOUNCE_MS) as unknown as number;
}

async function runGeneration(config: GenerateConfig): Promise<void> {
  running = true;
  token = new CancellationToken();
  try {
    const outcome = await generate(config, {
      doc,
      storage,
      token,
      request,
      onProgress: (update) => post({ type: 'progress', ...update }),
    });

    if (outcome.status === 'error') {
      post({ type: 'error', message: outcome.message });
      return;
    }
    if (outcome.status === 'cancelled') {
      post({ type: 'cancelled' });
      doc.notify(
        'Localization cancelled. ' + outcome.framesCreated + ' frame(s) were already created.'
      );
      return;
    }
    post({ type: 'done', summary: outcome.summary, warnings: outcome.warnings });
    doc.notify(
      'Localization complete — ' +
        outcome.summary.framesCreated +
        ' frame(s), ' +
        outcome.summary.warnings +
        ' warning(s).'
    );
  } catch (e) {
    post({ type: 'error', message: errorText(e) });
  } finally {
    running = false;
    // Settle anything still parked so its timer is cleared and no prefetch is
    // left waiting for a reply that will never come.
    translations.resolveAll({ translations: {}, error: 'The run ended.' });
  }
}

figma.on('selectionchange', () => {
  if (running) return;
  scheduleSelectionScan();
});

function describeMessage(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return typeof raw;
  const type = (raw as { type?: unknown }).type;
  return typeof type === 'string' ? 'type=' + type : 'no type field';
}

figma.ui.onmessage = async (raw: unknown) => {
  const msg = parseUiToPlugin(raw);
  if (!msg) {
    // A build mismatch between the two threads looks exactly like nothing
    // happening. Leave a breadcrumb rather than a mystery.
    swallow('dropped an unrecognized message', new Error(describeMessage(raw)));
    return;
  }

  switch (msg.type) {
    case 'ui-ready': {
      const state = await storage.loadAll();
      setDebugLogging(state.settings.debug);
      post({ type: 'settings', settings: state.settings, secrets: state.secrets, manual: state.manual });
      sendSelection();
      break;
    }

    case 'refresh-selection':
    case 'scan':
      sendSelection();
      break;

    case 'save-settings':
      setDebugLogging(msg.settings.debug);
      await storage.saveSettings(msg.settings);
      break;

    case 'save-secrets':
      await storage.saveSecrets(msg.secrets);
      break;

    case 'save-manual': {
      const dropped = await storage.saveManual(msg.manual);
      if (dropped) {
        // Hand-typed text. Losing it quietly is not an option.
        doc.notify(
          dropped + ' manual translation(s) could not be saved — the local storage limit was reached.',
          { error: true }
        );
      }
      break;
    }

    case 'generate':
      if (running) return;
      await runGeneration(msg.config);
      break;

    case 'translations':
      translations.resolve(msg.requestId, {
        translations: msg.translations,
        error: msg.error,
        issues: msg.issues,
      });
      break;

    case 'cancel':
      token.cancel();
      translations.resolveAll({ translations: {}, error: 'Cancelled.' });
      break;

    case 'clear-cache': {
      const removed = await storage.clearCache();
      doc.notify('Translation memory cleared (' + removed + ' language pair(s)).');
      break;
    }

    case 'select-nodes': {
      const nodes: SceneNode[] = [];
      for (const id of msg.ids) {
        try {
          const node = await doc.getNodeById(id);
          if (node && node.type !== 'PAGE' && node.type !== 'DOCUMENT') nodes.push(node as SceneNode);
        } catch (e) {
          swallow('select-nodes: ' + id, e);
        }
      }
      if (!nodes.length) {
        doc.notify('That layer no longer exists.');
        break;
      }
      try {
        doc.setSelection(nodes);
        doc.scrollAndZoomIntoView(nodes);
      } catch (e) {
        swallow('select-nodes: selecting', e);
        doc.notify('That layer is no longer on this page.');
      }
      break;
    }

    case 'http-request':
      post(await proxyHttpRequest(msg));
      break;

    case 'resize':
      try {
        figma.ui.resize(Math.max(360, msg.width), Math.max(400, msg.height));
      } catch (e) {
        swallow('resize', e);
      }
      break;

    case 'close':
      figma.closePlugin();
      break;
  }
};

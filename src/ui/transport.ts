/**
 * The concrete transport: browser `fetch`, with a fallback through the plugin
 * sandbox.
 *
 * The iframe is a normal browser context, so it is bound by CORS. The sandbox
 * `fetch` is proxied by the app but runs through the same null-origin browser
 * machinery, so CORS applies there too — the fallback covers transient
 * transport failures, not APIs that send no CORS headers at all. Those (DeepL)
 * are unreachable from a Figma plugin entirely; see "DeepL and CORS" in
 * docs/providers.md.
 *
 * Either way the request only reaches the domains allow-listed in manifest.json.
 */

import type { PluginToUi } from '../shared/messages';
import { Rpc, TimeoutError } from '../shared/rpc';
import type { HttpRequest, HttpResponse, Transport } from '../providers/transport';
import { TransportError } from '../providers/transport';
import { send } from './state';

const BRIDGE_TIMEOUT_MS = 120000;

type BridgeReply = Extract<PluginToUi, { type: 'http-response' }>;

const bridge = new Rpc<BridgeReply>('http', BRIDGE_TIMEOUT_MS);

/** Called by the message router when the sandbox answers a bridged request. */
export function resolveBridgeResponse(msg: BridgeReply): void {
  bridge.resolve(msg.requestId, msg);
}

async function viaBridge(req: HttpRequest): Promise<HttpResponse> {
  // The sandbox fetch cannot be aborted from here, so a cancelled run stops at
  // the next batch boundary rather than mid-request. Fail fast if we already
  // know the run is over.
  if (req.signal && req.signal.aborted) throw new TransportError('Cancelled.', false);

  let reply: BridgeReply;
  try {
    reply = await bridge.request((requestId) => {
      send({
        type: 'http-request',
        requestId,
        url: req.url,
        method: req.method,
        headers: req.headers,
        body: req.body,
      });
    });
  } catch (e) {
    if (e instanceof TimeoutError) throw new TransportError('The request timed out.', true);
    throw e;
  }

  if (reply.error) throw new TransportError(reply.error, reply.retryable !== false);
  return {
    ok: reply.ok,
    status: reply.status,
    statusText: reply.statusText,
    headers: reply.headers,
    body: reply.body,
  };
}

async function viaBrowser(req: HttpRequest): Promise<HttpResponse> {
  const res = await fetch(req.url, {
    method: req.method,
    headers: req.headers,
    body: req.method === 'GET' ? undefined : req.body,
    signal: req.signal,
  });
  const body = await res.text();
  const headers: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  return { ok: res.ok, status: res.status, statusText: res.statusText, headers, body };
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function isRetryable(e: unknown): boolean {
  return e instanceof TransportError ? e.retryable : true;
}

/** An abort is a decision, not a failure: never fall back, never retry. */
function isAbort(e: unknown, req: HttpRequest): boolean {
  if (req.signal && req.signal.aborted) return true;
  return e instanceof Error && e.name === 'AbortError';
}

export const httpRequest: Transport = async (req) => {
  const [first, second, secondLabel] = req.preferBridge
    ? // Older Figma builds have no sandbox fetch — fall back to the browser.
      [viaBridge, viaBrowser, 'the browser']
    : // A CORS rejection and a dropped connection are indistinguishable here,
      // so any transport failure is retried through the sandbox.
      [viaBrowser, viaBridge, 'the plugin sandbox'];

  try {
    return await first(req);
  } catch (primaryError) {
    if (isAbort(primaryError, req)) throw new TransportError('Cancelled.', false);
    try {
      return await second(req);
    } catch (fallbackError) {
      if (isAbort(fallbackError, req)) throw new TransportError('Cancelled.', false);
      // Only worth another attempt if neither route was definitively unusable.
      throw new TransportError(
        messageOf(primaryError) +
          ' (retry via ' +
          secondLabel +
          ' also failed: ' +
          messageOf(fallbackError) +
          ')',
        isRetryable(primaryError) && isRetryable(fallbackError)
      );
    }
  }
};

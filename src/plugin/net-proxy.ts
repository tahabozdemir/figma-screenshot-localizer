/**
 * The second network route.
 *
 * The UI is a normal browser iframe, so it is bound by CORS; requests it fails
 * are re-issued here over a message round-trip. Note this is NOT a CORS escape
 * hatch: the sandbox `fetch` is proxied through the same null-origin browser
 * machinery, so it only helps with transient transport failures. An API that
 * sends no CORS headers (DeepL) fails on this route too — see "DeepL and CORS"
 * in docs/providers.md.
 *
 * It is a dumb pipe on purpose: it does not know what a provider is, and it can
 * only reach the domains allow-listed in manifest.json either way.
 */

import type { PluginToUi, UiToPlugin } from '../shared/messages';
import { errorText } from '../shared/util';

type Request = Extract<UiToPlugin, { type: 'http-request' }>;
type Response = Extract<PluginToUi, { type: 'http-response' }>;

export async function proxyHttpRequest(msg: Request): Promise<Response> {
  let retryable = true;
  try {
    if (typeof fetch !== 'function') {
      // A missing capability will still be missing on the next attempt.
      retryable = false;
      throw new Error(
        'This Figma version cannot make requests from the plugin sandbox. Update Figma, or use a provider that allows browser requests.'
      );
    }
    const res = await fetch(msg.url, {
      method: msg.method,
      headers: msg.headers,
      body: msg.method === 'GET' ? undefined : msg.body,
    });
    const body = await res.text();
    const raw = (res as unknown as { headersObject?: Record<string, string> }).headersObject;
    const headers: Record<string, string> = {};
    for (const key of Object.keys(raw || {})) {
      headers[key.toLowerCase()] = (raw as Record<string, string>)[key];
    }
    return {
      type: 'http-response',
      requestId: msg.requestId,
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      headers,
      body,
    };
  } catch (e) {
    return {
      type: 'http-response',
      requestId: msg.requestId,
      ok: false,
      status: 0,
      statusText: '',
      headers: {},
      body: '',
      error: errorText(e),
      retryable,
    };
  }
}

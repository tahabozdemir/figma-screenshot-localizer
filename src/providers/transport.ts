/**
 * The seam between a provider and the network.
 *
 * Providers used to import the concrete browser/sandbox transport directly,
 * which made the interesting half of this codebase — batching, retry, backoff,
 * status-code mapping, malformed-JSON recovery — impossible to test without a
 * network and an API key. They now receive a `Transport` and nothing more, so
 * the tests drive them with a scripted fake.
 */

export interface HttpRequest {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
  /** Skip the browser attempt for hosts known to reject cross-origin calls. */
  preferBridge?: boolean;
  /** Aborts an in-flight request when the run is cancelled. */
  signal?: AbortSignal;
}

export interface HttpResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}

export type Transport = (req: HttpRequest) => Promise<HttpResponse>;

/** A request that never reached the server. `retryable: false` = giving up now is correct. */
export class TransportError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = 'TransportError';
    this.retryable = retryable;
  }
}

/** Best-effort JSON body, so a provider can still report an HTML error page. */
export function parseJson(body: string): any {
  try {
    return JSON.parse(body);
  } catch (e) {
    return null;
  }
}

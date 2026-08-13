/**
 * Request/reply over `postMessage`.
 *
 * Both threads need the same thing: hand out an id, park a promise, resolve it
 * when the other side answers, and give up after a timeout. It was implemented
 * twice — once for the translation round-trip in the sandbox, once for the HTTP
 * bridge in the iframe — with two subtly different leak profiles. This is the
 * one implementation; the differences that actually mattered (how long to wait,
 * what a timeout means) are parameters.
 */

export class TimeoutError extends Error {}

interface Entry<T> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class Rpc<T> {
  private readonly entries = new Map<string, Entry<T>>();
  private seq = 0;

  constructor(
    private readonly prefix: string,
    private readonly timeoutMs: number
  ) {}

  get pending(): number {
    return this.entries.size;
  }

  /**
   * `send` is called with the fresh id and must deliver it to the other thread.
   * The returned promise rejects with a TimeoutError if nothing comes back.
   */
  request(send: (requestId: string) => void): Promise<T> {
    const requestId = this.prefix + ++this.seq;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        // Drop the entry first: a late reply must not resolve a settled promise.
        if (this.entries.delete(requestId)) {
          reject(new TimeoutError('Timed out waiting for a reply (' + requestId + ').'));
        }
      }, this.timeoutMs);
      this.entries.set(requestId, { resolve, reject, timer });
      try {
        send(requestId);
      } catch (e) {
        this.reject(requestId, e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  /** Returns false when the id is unknown — a late or duplicate reply. */
  resolve(requestId: string, value: T): boolean {
    const entry = this.take(requestId);
    if (!entry) return false;
    entry.resolve(value);
    return true;
  }

  reject(requestId: string, error: Error): boolean {
    const entry = this.take(requestId);
    if (!entry) return false;
    entry.reject(error);
    return true;
  }

  /** Settles everything still in flight — used by cancel and by run teardown. */
  resolveAll(value: T): void {
    for (const entry of this.drain()) entry.resolve(value);
  }

  rejectAll(error: Error): void {
    for (const entry of this.drain()) entry.reject(error);
  }

  private take(requestId: string): Entry<T> | undefined {
    const entry = this.entries.get(requestId);
    if (!entry) return undefined;
    this.entries.delete(requestId);
    clearTimeout(entry.timer);
    return entry;
  }

  private drain(): Entry<T>[] {
    const all = Array.from(this.entries.values());
    this.entries.clear();
    // Clearing the map without clearing the timers left them ticking for the
    // full timeout; harmless but a real leak on a long session.
    for (const entry of all) clearTimeout(entry.timer);
    return all;
  }
}

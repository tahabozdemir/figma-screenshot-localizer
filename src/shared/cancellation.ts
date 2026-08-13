/**
 * Cooperative cancellation for one generation run.
 *
 * Replaces a module-level `cancelled` boolean. Being an object means the
 * pipeline is handed its token rather than reaching for a global, which is what
 * makes it testable — and it means a late cancel from a previous run cannot
 * touch the run that started after it.
 */
import { swallow } from './log';

export class CancellationToken {
  private flag = false;
  private readonly listeners: Array<() => void> = [];

  get cancelled(): boolean {
    return this.flag;
  }

  cancel(): void {
    if (this.flag) return;
    this.flag = true;
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (e) {
        // A listener must not stop the others from being told.
        swallow('cancellation listener', e);
      }
    }
    this.listeners.length = 0;
  }

  /** Fires once, immediately if cancellation already happened. */
  onCancel(listener: () => void): void {
    if (this.flag) listener();
    else this.listeners.push(listener);
  }
}

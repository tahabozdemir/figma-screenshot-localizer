/**
 * Debug logging for errors the plugin deliberately swallows.
 *
 * A lot of Figma calls are allowed to fail — a locked layer, a property the
 * running Figma version does not support, storage over quota. Aborting the run
 * for any of them would be worse than continuing, so they are caught and
 * ignored. That is correct behaviour and terrible for debugging: a contributor
 * chasing "why did this layer not change" has nothing to go on.
 *
 * `swallow()` keeps the behaviour and adds a breadcrumb behind a user-visible
 * Debug switch, so a bug report can carry the actual reason.
 */

import { errorText } from './util';

let enabled = false;

export function setDebugLogging(on: boolean): void {
  enabled = on;
}

/** Record a deliberately-ignored failure. Never throws. */
export function swallow(scope: string, e: unknown): void {
  if (!enabled) return;
  try {
    console.warn('[localizer] ' + scope + ': ' + errorText(e));
  } catch (ignored) {
    /* console itself is unavailable — nothing left to do */
  }
}

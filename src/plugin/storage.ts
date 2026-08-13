/**
 * Everything that lives in `figma.clientStorage`: settings, API keys, the
 * manual translation table and the translation memory.
 *
 * Two things changed from the flat blob this used to be.
 *
 * Keys live under their own storage key. They used to sit inside the settings
 * object, which the panel rewrites on a 400 ms debounce — so every keystroke in
 * any field pushed every API key across the postMessage boundary and rewrote
 * them to disk. They are now written only when a field is committed.
 *
 * And the storage is versioned with an actual migration rather than a `.v1`
 * suffix and hope: `lsl.settings.v1` is split into the two new keys on first
 * load and then removed, which also takes the plaintext keys out of the old
 * blob rather than leaving a second copy behind.
 */

import { normalizeManual, normalizeSecrets, normalizeSettings } from '../shared/defaults';
import { swallow } from '../shared/log';
import type { ManualTable, PersistedSettings, Secrets } from '../shared/types';
import type { StoragePort } from './figma-port';

export const SETTINGS_KEY = 'lsl.settings.v2';
export const LEGACY_SETTINGS_KEY = 'lsl.settings.v1';
export const SECRETS_KEY = 'lsl.secrets.v1';
export const MANUAL_KEY = 'lsl.manual.v1';
export const TM_PREFIX = 'lsl.tm.';

const TM_MAX_ENTRIES = 1200;
const MANUAL_MAX_ENTRIES = 4000;

export interface LoadedState {
  settings: PersistedSettings;
  secrets: Secrets;
  manual: ManualTable;
}

/**
 * v1 kept settings and keys in one object. Splitting is a pure function so the
 * migration is testable without a storage implementation.
 */
export function splitLegacySettings(raw: unknown): LoadedState {
  return {
    settings: normalizeSettings(raw),
    secrets: normalizeSecrets(raw),
    manual: {},
  };
}

/** Keeps the newest `max` entries — insertion order is chronological enough. */
export function capEntries(entries: Record<string, string>, max: number): Record<string, string> {
  const keys = Object.keys(entries);
  if (keys.length <= max) return entries;
  const out: Record<string, string> = {};
  for (const key of keys.slice(keys.length - max)) out[key] = entries[key];
  return out;
}

export interface CappedManual {
  table: ManualTable;
  /** Translations that did not fit the cap. Must never be dropped silently. */
  dropped: number;
}

/**
 * Drops blank values (the default) and caps the total, so quota goes on real
 * work.
 *
 * Unlike the translation memory, this is text a person typed by hand: losing it
 * is losing work, so the count comes back for the caller to report.
 */
export function capManual(table: ManualTable, max = MANUAL_MAX_ENTRIES): CappedManual {
  const out: ManualTable = {};
  let budget = max;
  let dropped = 0;
  for (const code of Object.keys(table || {})) {
    const bag = table[code];
    if (!bag || typeof bag !== 'object') continue;
    const kept: Record<string, string> = {};
    for (const id of Object.keys(bag)) {
      const value = bag[id];
      if (typeof value !== 'string' || !value.trim()) continue;
      if (budget-- <= 0) {
        dropped++;
        continue;
      }
      kept[id] = value;
    }
    if (Object.keys(kept).length) out[code] = kept;
  }
  return { table: out, dropped };
}

export function tmKey(cacheKey: string, source: string, target: string): string {
  return TM_PREFIX + cacheKey + '.' + source + '.' + target;
}

export class Storage {
  constructor(private readonly port: StoragePort) {}

  /** Reads everything the panel needs, migrating v1 on the way if present. */
  async loadAll(): Promise<LoadedState> {
    const manual = normalizeManual(await this.read(MANUAL_KEY));

    const current = await this.read(SETTINGS_KEY);
    if (current) {
      return {
        settings: normalizeSettings(current),
        secrets: normalizeSecrets(await this.read(SECRETS_KEY)),
        manual,
      };
    }

    const legacy = await this.read(LEGACY_SETTINGS_KEY);
    if (!legacy) {
      return { settings: normalizeSettings(null), secrets: normalizeSecrets(null), manual };
    }

    const migrated = splitLegacySettings(legacy);
    const settingsWritten = await this.saveSettings(migrated.settings);
    const secretsWritten = await this.saveSecrets(migrated.secrets);

    /* Drop the old blob only once both halves are *verifiably* written. Writes
       swallow their own failures, so awaiting them proved nothing: on a
       clientStorage over quota this deleted the only surviving copy of the
       user's API keys, silently and permanently. Keeping v1 costs a little
       space and re-runs the migration next launch. */
    if (settingsWritten && secretsWritten) {
      await this.remove(LEGACY_SETTINGS_KEY);
    } else {
      swallow(
        'migration',
        new Error('could not write the migrated settings; keeping ' + LEGACY_SETTINGS_KEY)
      );
    }
    return { settings: migrated.settings, secrets: migrated.secrets, manual };
  }

  saveSettings(settings: PersistedSettings): Promise<boolean> {
    return this.write(SETTINGS_KEY, settings);
  }

  saveSecrets(secrets: Secrets): Promise<boolean> {
    return this.write(SECRETS_KEY, secrets);
  }

  /** Returns how many hand-typed translations did not fit the quota cap. */
  async saveManual(table: ManualTable): Promise<number> {
    const capped = capManual(table);
    await this.write(MANUAL_KEY, capped.table);
    return capped.dropped;
  }

  /* ---- translation memory ---- */

  async loadTM(
    cacheKey: string | null,
    source: string,
    target: string
  ): Promise<Record<string, string>> {
    if (!cacheKey) return {};
    const raw = await this.read(tmKey(cacheKey, source, target));
    if (!raw || typeof raw !== 'object') return {};
    const out: Record<string, string> = {};
    const bag = raw as Record<string, unknown>;
    for (const key of Object.keys(bag)) {
      const value = bag[key];
      if (typeof value === 'string') out[key] = value;
    }
    return out;
  }

  async saveTM(
    cacheKey: string | null,
    source: string,
    target: string,
    entries: Record<string, string>
  ): Promise<void> {
    if (!cacheKey) return;
    await this.write(tmKey(cacheKey, source, target), capEntries(entries, TM_MAX_ENTRIES));
  }

  /** Wipes every bucket. Returns how many were removed. */
  async clearCache(): Promise<number> {
    let removed = 0;
    try {
      const keys = await this.port.keys();
      for (const key of keys) {
        if (key.indexOf(TM_PREFIX) === 0) {
          await this.port.remove(key);
          removed++;
        }
      }
    } catch (e) {
      swallow('clearCache', e);
    }
    return removed;
  }

  /* ---- primitives: storage failures are never fatal ---- */

  private async read(key: string): Promise<unknown> {
    try {
      return await this.port.get(key);
    } catch (e) {
      swallow('storage.read ' + key, e);
      return null;
    }
  }

  /** False when the write did not land — callers must not assume it did. */
  private async write(key: string, value: unknown): Promise<boolean> {
    try {
      await this.port.set(key, value);
      return true;
    } catch (e) {
      // Over quota or unavailable — the run still succeeds, we just lose the cache.
      swallow('storage.write ' + key, e);
      return false;
    }
  }

  private async remove(key: string): Promise<void> {
    try {
      await this.port.remove(key);
    } catch (e) {
      swallow('storage.remove ' + key, e);
    }
  }
}

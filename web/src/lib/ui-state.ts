// Per-browser UI state (view modes, list filters, navigation position), kept
// in localStorage under `heorth:ui:<key>`. Layout memory only, never data: it
// is per device rather than per member and survives logout. Same safe idiom
// as lib/hearth-prefs.ts — unavailable storage, corrupt JSON or a value that
// no longer fits its schema all degrade to the fallback instead of throwing.
import type { ZodType } from 'zod';

const PREFIX = 'heorth:ui:';

function read(key: string): unknown {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw == null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Private mode or quota: the state still holds for this page view.
  }
}

export function loadUiState<T>(key: string, schema: ZodType<T>, fallback: T): T {
  const parsed = schema.safeParse(read(key));
  return parsed.success ? parsed.data : fallback;
}

export function saveUiState<T>(key: string, value: T): void {
  write(key, value);
}

/**
 * Like loadUiState, but the value only counts while it is younger than
 * `maxAgeMs` — for state that should not outlive a working session, such as
 * which week an always-on wall is paged to.
 */
export function loadExpiringUiState<T>(
  key: string, schema: ZodType<T>, fallback: T, maxAgeMs: number, now = Date.now(),
): T {
  const stored = read(key) as { at?: unknown; value?: unknown } | undefined;
  if (!stored || typeof stored !== 'object' || typeof stored.at !== 'number') return fallback;
  if (now - stored.at > maxAgeMs) return fallback;
  const parsed = schema.safeParse(stored.value);
  return parsed.success ? parsed.data : fallback;
}

export function saveExpiringUiState<T>(key: string, value: T, now = Date.now()): void {
  write(key, { at: now, value });
}

export function clearUiState(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    // Storage unavailable — nothing was persisted to clear.
  }
}

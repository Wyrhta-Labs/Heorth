// Wall-local display preferences for the Hearth View, persisted in
// localStorage so the always-on kitchen panel keeps its setting across
// reloads. Same safe read/write idiom as lib/shopping-offline.ts: storage may
// be unavailable (private browsing, quota) or hold corrupt JSON — both degrade
// to the default rather than throwing.

import { z } from 'zod';
import {
  addMonths, addWeeks, differenceInCalendarMonths, differenceInCalendarWeeks, format, parseISO,
  startOfMonth, startOfWeek,
} from 'date-fns';
import { clearUiState, loadExpiringUiState, saveExpiringUiState } from './ui-state';

// Legacy/migration-only: the old single-toggle key, superseded by DISPLAY_KEY
// below. Kept only so loadHearthDisplayPrefs() can migrate it forward once.
const SHOW_KITH_REMINDERS_KEY = 'heorth:hearth:show-kith-reminders';

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full/unavailable — the toggle still works for the session.
  }
}

const DISPLAY_KEY = 'heorth:hearth:display';

/** Which wallboard elements the Hearth wall renders. All default ON. */
export interface HearthDisplayPrefs {
  kithReminders: boolean;
  tasks: boolean;
  meals: boolean;
  staleFooter: boolean;
}

function fieldOrTrue(v: unknown): boolean {
  return typeof v === 'boolean' ? v : true;
}

/**
 * Load the consolidated display prefs. Precedence: the new key wins outright;
 * otherwise a legacy `show-kith-reminders` boolean seeds `kithReminders` and
 * is migrated (written under the new key, legacy key deleted). Missing or
 * wrong-typed fields fall back to `true` individually.
 */
export function loadHearthDisplayPrefs(): HearthDisplayPrefs {
  const stored = readJson<Record<string, unknown>>(DISPLAY_KEY);
  if (stored && typeof stored === 'object') {
    return {
      kithReminders: fieldOrTrue(stored.kithReminders),
      tasks: fieldOrTrue(stored.tasks),
      meals: fieldOrTrue(stored.meals),
      staleFooter: fieldOrTrue(stored.staleFooter),
    };
  }
  const prefs: HearthDisplayPrefs = { kithReminders: true, tasks: true, meals: true, staleFooter: true };
  const legacy = readJson<unknown>(SHOW_KITH_REMINDERS_KEY);
  if (typeof legacy === 'boolean') {
    prefs.kithReminders = legacy;
    saveHearthDisplayPrefs(prefs);
    try {
      localStorage.removeItem(SHOW_KITH_REMINDERS_KEY);
    } catch {
      // Storage unavailable — the stale legacy key is harmless (new key wins).
    }
  }
  return prefs;
}

export function saveHearthDisplayPrefs(prefs: HearthDisplayPrefs): void {
  writeJson(DISPLAY_KEY, prefs);
}

// ---- Navigation position --------------------------------------------------
// Which week/month the wall is paged to, remembered across a reload but only
// for a short while: the wall is always on, and after a break it should be
// back on today rather than stuck on whatever someone last looked at. Stored
// as the absolute week/month start, not the offset, so a reload across a
// week or month boundary still shows the same week or month.

const POSITION_KEY = 'hearth:position';
export const HEARTH_POSITION_MAX_AGE_MS = 30 * 60_000;

const Position = z.object({
  week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  month: z.string().regex(/^\d{4}-\d{2}-01$/),
});

export interface HearthPosition {
  weekOffset: number;
  monthOffset: number;
}

const WEEK = { weekStartsOn: 1 } as const;

export function loadHearthPosition(now = Date.now()): HearthPosition {
  const stored = loadExpiringUiState(POSITION_KEY, Position.nullable(), null, HEARTH_POSITION_MAX_AGE_MS, now);
  if (!stored) return { weekOffset: 0, monthOffset: 0 };
  return {
    weekOffset: differenceInCalendarWeeks(parseISO(stored.week), now, WEEK),
    monthOffset: differenceInCalendarMonths(parseISO(stored.month), now),
  };
}

export function saveHearthPosition(pos: HearthPosition, now = Date.now()): void {
  if (pos.weekOffset === 0 && pos.monthOffset === 0) {
    clearUiState(POSITION_KEY);
    return;
  }
  saveExpiringUiState(POSITION_KEY, {
    week: format(startOfWeek(addWeeks(now, pos.weekOffset), WEEK), 'yyyy-MM-dd'),
    month: format(startOfMonth(addMonths(now, pos.monthOffset)), 'yyyy-MM-dd'),
  }, now);
}

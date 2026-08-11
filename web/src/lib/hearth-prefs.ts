// Wall-local display preferences for the Hearth View, persisted in
// localStorage so the always-on kitchen panel keeps its setting across
// reloads. Same safe read/write idiom as lib/shopping-offline.ts: storage may
// be unavailable (private browsing, quota) or hold corrupt JSON — both degrade
// to the default rather than throwing.

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

/** Whether KithLedger reminders show on the wall. Default ON (missing/corrupt → true). */
export function loadShowKithReminders(): boolean {
  const v = readJson<unknown>(SHOW_KITH_REMINDERS_KEY);
  return typeof v === 'boolean' ? v : true;
}

export function saveShowKithReminders(show: boolean): void {
  writeJson(SHOW_KITH_REMINDERS_KEY, show);
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

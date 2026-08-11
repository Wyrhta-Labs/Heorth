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

import { describe, it, expect, beforeEach } from 'vitest';
import { loadHearthDisplayPrefs, saveHearthDisplayPrefs } from './hearth-prefs';

const KEY = 'heorth:hearth:show-kith-reminders';

beforeEach(() => {
  localStorage.clear();
});

const DISPLAY_KEY = 'heorth:hearth:display';
const ALL_ON = { kithReminders: true, tasks: true, meals: true, staleFooter: true };

describe('hearth display preferences', () => {
  it('defaults to everything ON when nothing is stored', () => {
    expect(loadHearthDisplayPrefs()).toEqual(ALL_ON);
  });

  it('round-trips a full object under the documented key', () => {
    const prefs = { kithReminders: false, tasks: true, meals: false, staleFooter: true };
    saveHearthDisplayPrefs(prefs);
    expect(loadHearthDisplayPrefs()).toEqual(prefs);
    expect(JSON.parse(localStorage.getItem(DISPLAY_KEY)!)).toEqual(prefs);
  });

  it('tolerates corrupt storage (falls back to all-ON)', () => {
    localStorage.setItem(DISPLAY_KEY, '{not json');
    expect(loadHearthDisplayPrefs()).toEqual(ALL_ON);
  });

  it('falls back per-field for missing or wrong-typed fields', () => {
    localStorage.setItem(DISPLAY_KEY, JSON.stringify({ tasks: false, meals: 'nope' }));
    expect(loadHearthDisplayPrefs()).toEqual({ ...ALL_ON, tasks: false });
  });

  it('migrates the legacy kith boolean into kithReminders and deletes the legacy key', () => {
    localStorage.setItem(KEY, 'false'); // KEY = legacy 'heorth:hearth:show-kith-reminders'
    expect(loadHearthDisplayPrefs()).toEqual({ ...ALL_ON, kithReminders: false });
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(JSON.parse(localStorage.getItem(DISPLAY_KEY)!)).toEqual({ ...ALL_ON, kithReminders: false });
  });

  it('ignores the legacy key when the new key already exists', () => {
    localStorage.setItem(DISPLAY_KEY, JSON.stringify({ ...ALL_ON, kithReminders: true }));
    localStorage.setItem(KEY, 'false');
    expect(loadHearthDisplayPrefs().kithReminders).toBe(true);
  });

  it('ignores a wrong-typed legacy value (no migration write)', () => {
    localStorage.setItem(KEY, '"yes"');
    expect(loadHearthDisplayPrefs()).toEqual(ALL_ON);
    expect(localStorage.getItem(DISPLAY_KEY)).toBeNull();
  });
});

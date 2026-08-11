import { describe, it, expect, beforeEach } from 'vitest';
import { loadShowKithReminders, saveShowKithReminders } from './hearth-prefs';

const KEY = 'heorth:hearth:show-kith-reminders';

beforeEach(() => {
  localStorage.clear();
});

describe('show-kith-reminders preference', () => {
  it('defaults to ON when nothing is stored', () => {
    expect(loadShowKithReminders()).toBe(true);
  });

  it('round-trips OFF and back ON', () => {
    saveShowKithReminders(false);
    expect(loadShowKithReminders()).toBe(false);
    saveShowKithReminders(true);
    expect(loadShowKithReminders()).toBe(true);
  });

  it('persists as plain JSON under the documented key', () => {
    saveShowKithReminders(false);
    expect(localStorage.getItem(KEY)).toBe('false');
  });

  it('tolerates corrupt storage rather than throwing (falls back to default ON)', () => {
    localStorage.setItem(KEY, '{not json');
    expect(loadShowKithReminders()).toBe(true);
  });

  it('ignores stored values of the wrong type (falls back to default ON)', () => {
    localStorage.setItem(KEY, '"yes"');
    expect(loadShowKithReminders()).toBe(true);
  });
});

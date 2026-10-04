import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { z } from 'zod';
import {
  loadUiState, saveUiState, loadExpiringUiState, saveExpiringUiState,
} from './ui-state';

const View = z.enum(['week', 'month']);

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ui state', () => {
  it('returns the fallback when nothing is stored', () => {
    expect(loadUiState('calendar:view', View, 'week')).toBe('week');
  });

  it('round-trips a value under the heorth:ui: namespace', () => {
    saveUiState('calendar:view', 'month');
    expect(loadUiState('calendar:view', View, 'week')).toBe('month');
    expect(localStorage.getItem('heorth:ui:calendar:view')).toBe('"month"');
  });

  it('falls back on corrupt JSON', () => {
    localStorage.setItem('heorth:ui:calendar:view', '{not json');
    expect(loadUiState('calendar:view', View, 'week')).toBe('week');
  });

  it('falls back when the stored value no longer fits the schema', () => {
    localStorage.setItem('heorth:ui:calendar:view', '"year"');
    expect(loadUiState('calendar:view', View, 'week')).toBe('week');
  });

  it('degrades silently when storage throws', () => {
    // On the instance: tests/setup.ts may install a plain-object Storage.
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(() => saveUiState('calendar:view', 'month')).not.toThrow();
    expect(loadUiState('calendar:view', View, 'week')).toBe('week');
  });
});

describe('expiring ui state', () => {
  const MAX_AGE = 30 * 60_000;
  const T0 = Date.parse('2026-10-04T12:00:00Z');

  it('restores a value saved within the max age', () => {
    saveExpiringUiState('hearth:position', 'month', T0);
    expect(loadExpiringUiState('hearth:position', View, 'week', MAX_AGE, T0 + MAX_AGE - 1)).toBe('month');
  });

  it('returns the fallback once the value is older than the max age', () => {
    saveExpiringUiState('hearth:position', 'month', T0);
    expect(loadExpiringUiState('hearth:position', View, 'week', MAX_AGE, T0 + MAX_AGE + 1)).toBe('week');
  });

  it('falls back when the stored envelope is malformed', () => {
    localStorage.setItem('heorth:ui:hearth:position', '"month"');
    expect(loadExpiringUiState('hearth:position', View, 'week', MAX_AGE, T0)).toBe('week');
  });
});

import { describe, it, expect } from 'vitest';
import { focusDay, keepHighlighted } from './day-focus';

describe('focusDay', () => {
  it('keeps a requested day inside the strip window', () => {
    expect(focusDay('2026-10-15', '2026-10-15')).toBe('2026-10-15');
    expect(focusDay('2026-10-21', '2026-10-15')).toBe('2026-10-21');
  });

  it('falls back to today for no day, a past day, or one beyond the strip', () => {
    expect(focusDay(undefined, '2026-10-15')).toBe('2026-10-15');
    expect(focusDay('2026-10-14', '2026-10-15')).toBe('2026-10-15');
    expect(focusDay('2026-10-22', '2026-10-15')).toBe('2026-10-15');
  });
});

describe('keepHighlighted', () => {
  it('is a plain cap when nothing is highlighted', () => {
    expect(keepHighlighted([1, 2, 3, 4], 2, () => false)).toEqual([1, 2]);
  });

  it('keeps highlighted items past the cap in view, in display order', () => {
    expect(keepHighlighted([1, 2, 3, 4, 5], 3, (n) => n === 5)).toEqual([1, 2, 5]);
  });
});

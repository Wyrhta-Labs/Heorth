// web/src/lib/format.test.ts
import { describe, it, expect } from 'vitest';
import { formatMoney, progressPercent, weekDays, dayLabel } from './format';

describe('formatMoney', () => {
  it('formats a numeric string as USD', () => {
    expect(formatMoney('400.00')).toBe('$400.00');
  });
  it('formats a number as USD', () => {
    expect(formatMoney(120)).toBe('$120.00');
  });
  it('renders an em dash for empty/nullish', () => {
    expect(formatMoney(null)).toBe('—');
    expect(formatMoney('')).toBe('—');
  });
});

describe('progressPercent', () => {
  it('computes a clamped percentage', () => {
    expect(progressPercent(50, 200)).toBe(25);
    expect(progressPercent(300, 200)).toBe(100); // over budget clamps to 100
    expect(progressPercent(10, 0)).toBe(0);       // zero budget => 0
  });
});

describe('weekDays / dayLabel', () => {
  it('returns 7 Monday-first days for a reference date', () => {
    const days = weekDays(new Date('2026-07-15T12:00:00Z')); // a Wednesday
    expect(days.length).toBe(7);
    expect(dayLabel(days[0]!).dow).toBe('Mon');
    expect(dayLabel(days[6]!).dow).toBe('Sun');
  });
});

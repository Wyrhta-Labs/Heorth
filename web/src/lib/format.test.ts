// web/src/lib/format.test.ts
import { describe, it, expect } from 'vitest';
import { formatMoney, progressPercent, formatDate, formatTime, weekDays, dayLabel, dayRangeIso } from './format';
import { startOfDay, endOfDay, parseISO } from 'date-fns';
import { de, enGB, enUS } from 'date-fns/locale';

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
  const ref = new Date('2026-07-15T12:00:00Z'); // a Wednesday
  it('follows the locale week start (enUS: Sunday)', () => {
    const days = weekDays(ref, enUS);
    expect(days.length).toBe(7);
    expect(dayLabel(days[0]!, enUS).dow).toBe('Sun');
    expect(dayLabel(days[6]!, enUS).dow).toBe('Sat');
  });
  it('is Monday-first for de and enGB', () => {
    expect(dayLabel(weekDays(ref, de)[0]!, de).dow).toBe('Mo.');
    expect(dayLabel(weekDays(ref, enGB)[0]!, enGB).dow).toBe('Mon');
  });
  it('defaults to enUS and keeps iso locale-free', () => {
    expect(dayLabel(weekDays(ref)[0]!).dow).toBe('Sun');
    expect(dayLabel(new Date('2026-07-13T12:00:00'), de).iso).toBe('2026-07-13');
  });
});

describe('formatDate / formatTime localize', () => {
  it('renders per-locale date and time', () => {
    expect(formatDate('2026-07-13T18:30:00Z', enUS)).toMatch(/Jul 13, 2026/);
    expect(formatDate('2026-07-13T18:30:00Z', de)).toMatch(/13\.\s?Juli 2026/);
    expect(formatTime('2026-07-13T09:05:00', enUS)).toBe('9:05 AM');
    expect(formatTime('2026-07-13T09:05:00', de)).toBe('09:05');
  });
});

describe('dayRangeIso', () => {
  it('brackets the LOCAL calendar day (not a Z-suffixed local date)', () => {
    const d = new Date('2026-07-13T15:30:00'); // parsed in local time
    const { from, to } = dayRangeIso(d);
    // from/to are the exact local day boundaries, expressed as UTC instants.
    expect(parseISO(from).getTime()).toBe(startOfDay(d).getTime());
    expect(parseISO(to).getTime()).toBe(endOfDay(d).getTime());
    // Local calendar date of both bounds equals the input's local date.
    expect(dayLabel(parseISO(from)).iso).toBe(dayLabel(d).iso);
    expect(dayLabel(parseISO(to)).iso).toBe(dayLabel(d).iso);
    // Spans one full day minus a millisecond, in any timezone.
    expect(parseISO(to).getTime() - parseISO(from).getTime()).toBe(86_399_999);
  });
});

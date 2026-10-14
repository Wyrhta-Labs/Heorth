// web/src/lib/format.test.ts
import { describe, it, expect } from 'vitest';
import { formatMoney, progressPercent, formatDate, formatTime, weekDays, nextDays, dayLabel, dayRangeIso, startOfDayInTimeZone, formatClock, instantFromWallClock, wallClockInput } from './format';
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
  it('is Monday-first in every locale, like the hearth/calendar/meals ranges (enUS too)', () => {
    const days = weekDays(ref);
    expect(days.length).toBe(7);
    expect(dayLabel(days[0]!, enUS).dow).toBe('Mon');
    expect(dayLabel(days[6]!, enUS).dow).toBe('Sun');
    expect(dayLabel(days[0]!, enUS).iso).toBe('2026-07-13');
  });
  it('is Monday-first for de and enGB', () => {
    expect(dayLabel(weekDays(ref)[0]!, de).dow).toBe('Mo.');
    expect(dayLabel(weekDays(ref)[0]!, enGB).dow).toBe('Mon');
  });
  it('defaults to enUS and keeps iso locale-free', () => {
    expect(dayLabel(weekDays(ref)[0]!).dow).toBe('Mon');
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

describe('nextDays', () => {
  it('starts on the reference day and runs seven consecutive days, across a week boundary', () => {
    const sunday = new Date(2026, 9, 4); // Sun 4 Oct 2026
    const days = nextDays(sunday);
    expect(days).toHaveLength(7);
    expect(dayLabel(days[0]!).iso).toBe('2026-10-04');
    expect(dayLabel(days[1]!).iso).toBe('2026-10-05');
    expect(dayLabel(days[6]!).iso).toBe('2026-10-10');
  });
});

describe('household-zone helpers', () => {
  it('startOfDayInTimeZone: the instant a calendar day begins in a zone', () => {
    // NZST (UTC+12) in July, NZDT (UTC+13) in October.
    expect(startOfDayInTimeZone('2026-07-27', 'Pacific/Auckland').toISOString()).toBe('2026-07-26T12:00:00.000Z');
    expect(startOfDayInTimeZone('2026-10-14', 'Pacific/Auckland').toISOString()).toBe('2026-10-13T11:00:00.000Z');
    expect(startOfDayInTimeZone('2026-07-27', 'America/Los_Angeles').toISOString()).toBe('2026-07-27T07:00:00.000Z');
    expect(startOfDayInTimeZone('2026-07-27', 'UTC').toISOString()).toBe('2026-07-27T00:00:00.000Z');
  });

  it('startOfDayInTimeZone: a day after a DST change starts at the new offset', () => {
    // Europe/Berlin switches to CET on Sun 2026-10-25 at 03:00 CEST.
    expect(startOfDayInTimeZone('2026-10-25', 'Europe/Berlin').toISOString()).toBe('2026-10-24T22:00:00.000Z');
    expect(startOfDayInTimeZone('2026-10-26', 'Europe/Berlin').toISOString()).toBe('2026-10-25T23:00:00.000Z');
  });

  it('formatClock: the zone wall-clock time of an instant', () => {
    expect(formatClock(new Date('2026-07-26T13:05:00Z'), 'Pacific/Auckland')).toBe('01:05');
    expect(formatClock(new Date('2026-07-26T13:05:00Z'), 'America/Los_Angeles')).toBe('06:05');
  });
});

describe('instantFromWallClock across DST gaps and folds', () => {
  it('starts a day whose midnight is skipped at its first instant (America/Santiago)', () => {
    // Chile springs forward at 00:00 on Sun 6 Sep 2026: the day begins at 01:00 (-03), 04:00Z.
    expect(startOfDayInTimeZone('2026-09-06', 'America/Santiago').toISOString()).toBe('2026-09-06T04:00:00.000Z');
    expect(instantFromWallClock('2026-09-06T00:30', 'America/Santiago').toISOString()).toBe('2026-09-06T04:00:00.000Z');
    // The day before is unaffected and ends right where the next one starts.
    expect(startOfDayInTimeZone('2026-09-05', 'America/Santiago').toISOString()).toBe('2026-09-05T04:00:00.000Z');
  });

  it('moves a skipped wall time forward to the first valid instant (Berlin spring gap)', () => {
    // 02:00 → 03:00 on 29 Mar 2026: 02:30 does not exist; 03:00 CEST is 01:00Z.
    expect(instantFromWallClock('2026-03-29T02:30', 'Europe/Berlin').toISOString()).toBe('2026-03-29T01:00:00.000Z');
    expect(instantFromWallClock('2026-03-29T03:30', 'Europe/Berlin').toISOString()).toBe('2026-03-29T01:30:00.000Z');
  });

  it('resolves a repeated wall time to the earlier instant, so the first one round-trips (Berlin autumn fold)', () => {
    // 03:00 → 02:00 on 25 Oct 2026: 02:30 happens at 00:30Z (CEST) and 01:30Z (CET).
    const first = new Date('2026-10-25T00:30:00Z');
    expect(wallClockInput(first, 'Europe/Berlin')).toBe('2026-10-25T02:30');
    expect(instantFromWallClock(wallClockInput(first, 'Europe/Berlin'), 'Europe/Berlin').toISOString()).toBe(first.toISOString());
    expect(instantFromWallClock('2026-10-25T03:30', 'Europe/Berlin').toISOString()).toBe('2026-10-25T02:30:00.000Z');
  });
});

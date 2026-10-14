// The browser sits in Europe/Berlin, whose clocks jump 02:00 → 03:00 on
// 2026-03-29. A household wall-clock time inside that gap must still print
// as itself: it exists in the household's zone, only not in the browser's.
process.env.TZ = 'Europe/Berlin';

import { describe, it, expect } from 'vitest';
import { de, enGB, enUS } from 'date-fns/locale';
import { formatClock, formatTime } from './format';

describe('household clock times across a browser DST gap', () => {
  // 02:30Z on 29 Mar 2026: 02:30 in UTC, a time that does not exist in Berlin.
  const inGap = new Date('2026-03-29T02:30:00Z');

  it('formatClock prints the household wall clock, not a shifted browser time', () => {
    expect(formatClock(inGap, 'UTC')).toBe('02:30');
    expect(formatClock(inGap, 'UTC', enUS, 'p')).toBe('2:30 AM');
    expect(formatClock(inGap, 'UTC', enGB, 'p')).toBe('02:30');
    expect(formatClock(inGap, 'UTC', de, 'p')).toBe('02:30');
  });

  it('formatTime with a household zone does too', () => {
    expect(formatTime('2026-03-29T02:30:00Z', enGB, 'UTC')).toBe('02:30');
  });

  it('matches date-fns output on ordinary times', () => {
    const t = new Date('2026-07-26T20:05:00Z'); // 08:05 / 20:05
    expect(formatClock(t, 'Pacific/Auckland', enUS, 'p')).toBe('8:05 AM');
    expect(formatClock(t, 'UTC', enUS, 'p')).toBe('8:05 PM');
    expect(formatClock(t, 'Pacific/Auckland', de, 'p')).toBe('08:05');
  });
});

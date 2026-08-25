import { describe, it, expect } from 'vitest';
import { updateHousehold } from '../src/household/service.js';
import { householdMidnightUtc, householdToday } from '../src/modules/weorc/dates.js';
import { addInterval, addDays, nextDueOn, type RecurrenceSpec } from '../src/modules/weorc/recurrence.js';
import { householdCore } from '../src/wiring.js';

const fixed = (over: Partial<RecurrenceSpec> = {}): RecurrenceSpec => ({
  mode: 'fixed', intervalUnit: 'week', intervalCount: 1, anchorDate: '2026-09-01', ...over,
});
const fromCompletion = (over: Partial<RecurrenceSpec> = {}): RecurrenceSpec => ({
  mode: 'from_completion', intervalUnit: 'month', intervalCount: 12, anchorDate: '2026-09-01', ...over,
});

describe('addInterval', () => {
  it('adds days and weeks', () => {
    expect(addInterval('2026-09-01', 'day', 3)).toBe('2026-09-04');
    expect(addInterval('2026-09-01', 'week', 2)).toBe('2026-09-15');
  });

  it('crosses a year boundary', () => {
    expect(addInterval('2026-12-30', 'day', 3)).toBe('2027-01-02');
  });

  it('clamps a month addition into the shorter target month', () => {
    expect(addInterval('2026-01-31', 'month', 1)).toBe('2026-02-28');
    expect(addInterval('2028-01-31', 'month', 1)).toBe('2028-02-29');
    expect(addInterval('2026-08-31', 'month', 1)).toBe('2026-09-30');
  });
});

describe('addDays', () => {
  it('is DST-proof - pure calendar arithmetic', () => {
    // 2026-03-29 is the European spring-forward. A naive +24h would land on the
    // 29th twice or skip it; calendar arithmetic just counts days.
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29');
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
  });
});

describe('nextDueOn - from_completion', () => {
  it('uses anchorDate when nothing has ever been done', () => {
    expect(nextDueOn(fromCompletion(), null, '2026-09-20')).toBe('2026-09-01');
  });

  it('recurs from the last terminal date, not from a grid', () => {
    expect(nextDueOn(fromCompletion(), '2026-09-15', '2026-09-20')).toBe('2027-09-15');
  });

  it('DRIFTS deliberately: the completion becomes the new origin', () => {
    const monthly = fromCompletion({ intervalCount: 1 });
    expect(nextDueOn(monthly, '2026-01-31', '2026-02-01')).toBe('2026-02-28');
    // and from there it stays on the 28th - it recurs from when you last did it
    expect(nextDueOn(monthly, '2026-02-28', '2026-03-01')).toBe('2026-03-28');
  });

  it('does NOT fast-forward - a long-neglected routine stays one item overdue', () => {
    expect(nextDueOn(fromCompletion(), '2020-01-01', '2026-09-20')).toBe('2021-01-01');
  });
});

describe('nextDueOn - fixed grid', () => {
  it('uses anchorDate when nothing has ever been done', () => {
    expect(nextDueOn(fixed(), null, '2026-09-01')).toBe('2026-09-01');
  });

  it('takes the next slot after the last terminal occurrence', () => {
    expect(nextDueOn(fixed(), '2026-09-01', '2026-09-02')).toBe('2026-09-08');
  });

  it('fast-forwards over a gap instead of building a backlog', () => {
    // Away three weeks: last done 08-11 (a Tuesday grid), today 08-25.
    // Slots are 08-18 and 08-25; the rule leaves the latest whose SUCCESSOR is
    // still future, i.e. 08-25 - one chore today, not one on the 18th that
    // immediately breeds another.
    const weekly = fixed({ anchorDate: '2026-08-04' });
    expect(nextDueOn(weekly, '2026-08-11', '2026-08-25')).toBe('2026-08-25');
  });

  it('leaves exactly one overdue item after a long absence', () => {
    const weekly = fixed({ anchorDate: '2026-08-04' });
    expect(nextDueOn(weekly, '2026-08-11', '2026-10-01')).toBe('2026-09-29');
  });

  it('does NOT drift on month-end: every slot is computed from the origin', () => {
    const monthly = fixed({ intervalUnit: 'month', intervalCount: 1, anchorDate: '2026-01-31' });
    expect(nextDueOn(monthly, '2026-01-31', '2026-02-01')).toBe('2026-02-28');
    // the crux: the NEXT one returns to the 31st, because it is anchor + 2
    // months, not (clamped February) + 1 month
    expect(nextDueOn(monthly, '2026-02-28', '2026-03-01')).toBe('2026-03-31');
  });

  it('never returns a slot on or before the last terminal occurrence', () => {
    const weekly = fixed({ anchorDate: '2026-08-04' });
    expect(nextDueOn(weekly, '2026-08-25', '2026-08-25') > '2026-08-25').toBe(true);
  });
});

describe('household zone, not server zone', () => {
  it('resolves midnight in the household zone', async () => {
    await householdCore.seedHousehold({ name: 'Test Household' });
    await updateHousehold({ timezone: 'Europe/Berlin' });
    const instant = await householdMidnightUtc('2026-07-01');
    // Europe/Berlin is UTC+2 in July, so local midnight is 22:00 UTC the day before.
    expect(instant.toISOString()).toBe('2026-06-30T22:00:00.000Z');
    expect(await householdToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

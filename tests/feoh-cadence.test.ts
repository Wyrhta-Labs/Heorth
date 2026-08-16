import { describe, it, expect } from 'vitest';
import { addPeriods, projectDueDates, isProjectedDate, isCadence } from '../src/modules/feoh/cadence.js';

describe('cadence math', () => {
  it('weekly adds 7-day steps', () => {
    expect(addPeriods('2026-01-31', 'weekly', 1)).toBe('2026-02-07');
    expect(addPeriods('2026-12-28', 'weekly', 1)).toBe('2027-01-04');
  });
  it('monthly clamps to month length, always from the anchor', () => {
    expect(addPeriods('2026-01-31', 'monthly', 1)).toBe('2026-02-28');
    expect(addPeriods('2026-01-31', 'monthly', 2)).toBe('2026-03-31'); // NOT 03-28
    expect(addPeriods('2026-01-31', 'monthly', 3)).toBe('2026-04-30');
    expect(addPeriods('2024-01-31', 'monthly', 1)).toBe('2024-02-29'); // leap year
  });
  it('quarterly / semiannual / yearly step in months with clamping', () => {
    expect(addPeriods('2026-08-31', 'quarterly', 1)).toBe('2026-11-30');
    expect(addPeriods('2026-08-31', 'semiannual', 1)).toBe('2027-02-28');
    expect(addPeriods('2024-02-29', 'yearly', 1)).toBe('2025-02-28');
  });
  it('projects anchor..toInclusive and honours bounds', () => {
    expect(projectDueDates('2026-08-01', 'monthly', '2026-10-31'))
      .toEqual(['2026-08-01', '2026-09-01', '2026-10-01']);
    expect(projectDueDates('2026-08-01', 'monthly', '2026-07-01')).toEqual([]);
  });
  it('isProjectedDate accepts exact projections only', () => {
    expect(isProjectedDate('2026-01-31', 'monthly', '2026-02-28')).toBe(true);
    expect(isProjectedDate('2026-01-31', 'monthly', '2026-02-27')).toBe(false);
    expect(isProjectedDate('2026-01-31', 'monthly', '2026-01-15')).toBe(false); // before anchor
  });
  it('isCadence rejects legacy free text', () => {
    expect(isCadence('monthly')).toBe(true);
    expect(isCadence('P1M')).toBe(false);
  });
});

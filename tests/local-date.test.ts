import { describe, it, expect } from 'vitest';
import { localDateOf, zonedMidnightUtc } from '../src/lib/local-date.js';

describe('localDateOf', () => {
  it('Berlin summer (CEST, UTC+2): a late-UTC instant is the next local day', () => {
    expect(localDateOf('2026-07-24T22:00:00.000Z', 'Europe/Berlin')).toBe('2026-07-25');
    expect(localDateOf(new Date('2026-07-24T21:59:59.000Z'), 'Europe/Berlin')).toBe('2026-07-24');
  });

  it('Berlin winter (CET, UTC+1)', () => {
    expect(localDateOf('2026-01-15T23:00:00.000Z', 'Europe/Berlin')).toBe('2026-01-16');
    expect(localDateOf('2026-01-15T22:59:59.000Z', 'Europe/Berlin')).toBe('2026-01-15');
  });

  it('America/New_York (negative offset): an early-UTC instant is the previous local day', () => {
    expect(localDateOf('2026-07-25T00:00:00.000Z', 'America/New_York')).toBe('2026-07-24');
    expect(localDateOf('2026-07-25T04:00:00.000Z', 'America/New_York')).toBe('2026-07-25');
  });

  it('UTC is the identity zone', () => {
    expect(localDateOf('2026-07-25T00:00:00.000Z', 'UTC')).toBe('2026-07-25');
    expect(localDateOf('2026-07-25T23:59:59.000Z', 'UTC')).toBe('2026-07-25');
  });

  it('throws on a malformed instant', () => {
    expect(() => localDateOf('not-a-date', 'UTC')).toThrow();
  });
});

describe('zonedMidnightUtc', () => {
  it('Berlin summer midnight is 22:00Z the previous UTC day', () => {
    expect(zonedMidnightUtc('2026-07-25', 'Europe/Berlin').toISOString()).toBe('2026-07-24T22:00:00.000Z');
  });

  it('Berlin winter midnight is 23:00Z the previous UTC day', () => {
    expect(zonedMidnightUtc('2026-01-16', 'Europe/Berlin').toISOString()).toBe('2026-01-15T23:00:00.000Z');
  });

  it('New York midnight is 04:00Z (EDT) / 05:00Z (EST)', () => {
    expect(zonedMidnightUtc('2026-07-25', 'America/New_York').toISOString()).toBe('2026-07-25T04:00:00.000Z');
    expect(zonedMidnightUtc('2026-01-16', 'America/New_York').toISOString()).toBe('2026-01-16T05:00:00.000Z');
  });

  it('UTC midnight is itself', () => {
    expect(zonedMidnightUtc('2026-07-25', 'UTC').toISOString()).toBe('2026-07-25T00:00:00.000Z');
  });

  it('resolves correctly on a DST transition day (Berlin spring-forward 2026-03-29)', () => {
    // Midnight itself is before the 02:00→03:00 jump, so it exists: CET, UTC+1.
    expect(zonedMidnightUtc('2026-03-29', 'Europe/Berlin').toISOString()).toBe('2026-03-28T23:00:00.000Z');
    // Day after the transition is fully CEST.
    expect(zonedMidnightUtc('2026-03-30', 'Europe/Berlin').toISOString()).toBe('2026-03-29T22:00:00.000Z');
    // Fall-back day (2026-10-25) midnight is still CEST.
    expect(zonedMidnightUtc('2026-10-25', 'Europe/Berlin').toISOString()).toBe('2026-10-24T22:00:00.000Z');
  });

  it('throws on a malformed date string', () => {
    expect(() => zonedMidnightUtc('2026-7-5', 'UTC')).toThrow();
    expect(() => zonedMidnightUtc('garbage', 'Europe/Berlin')).toThrow();
    expect(() => zonedMidnightUtc('2026-07-25T00:00:00Z', 'UTC')).toThrow();
  });

  it('round-trips: localDateOf(zonedMidnightUtc(d, z), z) === d', () => {
    const cases: Array<[string, string]> = [
      ['2026-07-25', 'Europe/Berlin'],
      ['2026-01-16', 'Europe/Berlin'],
      ['2026-03-29', 'Europe/Berlin'],
      ['2026-07-25', 'America/New_York'],
      ['2026-01-16', 'America/New_York'],
      ['2026-07-25', 'UTC'],
      ['2026-12-31', 'Pacific/Auckland'],
    ];
    for (const [d, z] of cases) {
      expect(localDateOf(zonedMidnightUtc(d, z), z)).toBe(d);
    }
  });
});

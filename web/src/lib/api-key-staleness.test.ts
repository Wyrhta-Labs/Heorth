import { describe, it, expect } from 'vitest';
import { isStaleKey } from './api-key-staleness';

const now = new Date('2026-10-22T12:00:00Z');
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();

describe('isStaleKey', () => {
  it('flags a key unused for more than 90 days', () => {
    expect(isStaleKey({ createdAt: daysAgo(200), lastUsedAt: daysAgo(91) }, now)).toBe(true);
  });

  it('keeps a key used within 90 days', () => {
    expect(isStaleKey({ createdAt: daysAgo(200), lastUsedAt: daysAgo(89) }, now)).toBe(false);
  });

  it('flags a never-used key older than 30 days', () => {
    expect(isStaleKey({ createdAt: daysAgo(31), lastUsedAt: null }, now)).toBe(true);
  });

  it('gives a fresh, never-used key 30 days of grace', () => {
    expect(isStaleKey({ createdAt: daysAgo(29), lastUsedAt: null }, now)).toBe(false);
  });
});

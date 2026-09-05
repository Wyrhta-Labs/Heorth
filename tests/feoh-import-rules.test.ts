import { describe, it, expect } from 'vitest';
import { matchRule, orderRules } from '../src/modules/feoh/import/rules.js';

const r = (id: string, pattern: string, priority = 0, enabled = true) => ({ id, pattern, priority, enabled });

describe('import rules', () => {
  it('matches case-insensitively as a substring of the payee', () => {
    expect(matchRule('REWE Markt 123', [r('a', 'rewe')])?.id).toBe('a');
    expect(matchRule('Aldi', [r('a', 'rewe')])).toBeNull();
  });

  it('orders by (priority, id) and the first enabled match wins', () => {
    const rules = [r('b', 'markt', 5), r('a', 'rewe', 5), r('z', 'rewe', 1, false), r('c', 'rewe', 9)];
    expect(orderRules(rules).map((x) => x.id)).toEqual(['z', 'a', 'b', 'c']);
    expect(matchRule('Rewe Markt', rules)?.id).toBe('a');
  });

  it('skips disabled rules entirely', () => {
    expect(matchRule('Rewe', [r('a', 'rewe', 0, false)])).toBeNull();
  });

  it('is deterministic for two rules matching the same payee', () => {
    const rules = [r('2', 'rewe'), r('1', 'rewe')];
    expect(matchRule('rewe', rules)?.id).toBe('1');
    expect(matchRule('rewe', [...rules].reverse())?.id).toBe('1');
  });
});

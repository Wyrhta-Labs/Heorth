import { describe, it, expect } from 'vitest';
import en from './locales/en.json';
import de from './locales/de.json';

/** Flatten {"a":{"b":"x {{n}}"}} -> Map("a.b" -> "x {{n}}"). */
function flatten(obj: Record<string, unknown>, prefix = '', out = new Map<string, string>()): Map<string, string> {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out.set(key, v);
    else flatten(v as Record<string, unknown>, key, out);
  }
  return out;
}

function placeholders(msg: string): string[] {
  return [...msg.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]!).sort();
}

describe('catalog parity', () => {
  const enFlat = flatten(en);
  const deFlat = flatten(de);

  it('en and de have identical key sets', () => {
    expect([...deFlat.keys()].sort()).toEqual([...enFlat.keys()].sort());
  });

  it('every key has identical interpolation placeholders in both languages', () => {
    for (const [key, msg] of enFlat) {
      const deMsg = deFlat.get(key);
      if (deMsg === undefined) continue; // key-set test reports this
      expect(placeholders(deMsg), `placeholder drift in "${key}"`).toEqual(placeholders(msg));
    }
  });

  it('no message is empty', () => {
    for (const [key, msg] of [...enFlat, ...deFlat]) {
      expect(msg.trim(), `empty message for "${key}"`).not.toBe('');
    }
  });
});

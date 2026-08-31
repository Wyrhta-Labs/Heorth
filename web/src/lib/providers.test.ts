import { describe, it, expect } from 'vitest';
import { PROVIDERS } from './providers';

describe('PROVIDERS registry', () => {
  it('registers Microsoft 365 with its capabilities', () => {
    const m365 = PROVIDERS.find((p) => p.id === 'm365');
    expect(m365).toBeDefined();
    expect(m365!.capabilities).toEqual(['calendar', 'tasks']);
  });

  it('registers Google with its capabilities', () => {
    const google = PROVIDERS.find((p) => p.id === 'google');
    expect(google).toBeDefined();
    expect(google!.capabilities).toEqual(['calendar', 'tasks']);
  });

  it('gives every provider the full API surface and distinct i18n keys', () => {
    const nameKeys = new Set<string>();
    for (const p of PROVIDERS) {
      expect(typeof p.api.useStatus).toBe('function');
      expect(typeof p.api.getConnectUrl).toBe('function');
      expect(typeof p.api.disconnect).toBe('function');
      expect(p.nameKey).toBeTruthy();
      expect(p.descriptionKey).toBeTruthy();
      nameKeys.add(p.nameKey);
    }
    expect(nameKeys.size).toBe(PROVIDERS.length);
  });
});

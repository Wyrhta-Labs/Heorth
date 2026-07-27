import { describe, it, expect } from 'vitest';
import { resolveLocale, DEFAULT_RESOLVED } from './locale-map';

// Mirror of SUPPORTED_LOCALES in src/household/options.ts (server source of truth).
const SUPPORTED = [
  'da-DK', 'de-AT', 'de-CH', 'de-DE', 'en-AU', 'en-CA', 'en-GB', 'en-US',
  'es-ES', 'fi-FI', 'fr-FR', 'it-IT', 'nb-NO', 'nl-NL', 'pl-PL', 'pt-PT', 'sv-SE',
];

describe('resolveLocale', () => {
  it('resolves every supported locale to a real date-fns Locale', () => {
    for (const tag of SUPPORTED) {
      const r = resolveLocale(tag);
      expect(r.dateFnsLocale.code, tag).toBeTruthy();
      expect(typeof r.dateFnsLocale.localize?.day).toBe('function');
    }
  });

  it('routes German regions to the de catalog, everything else to en', () => {
    expect(resolveLocale('de-DE').language).toBe('de');
    expect(resolveLocale('de-AT').language).toBe('de');
    expect(resolveLocale('de-CH').language).toBe('de');
    for (const tag of SUPPORTED.filter((t) => !t.startsWith('de-'))) {
      expect(resolveLocale(tag).language, tag).toBe('en');
    }
  });

  it('picks region-correct date-fns locales where they exist', () => {
    expect(resolveLocale('de-AT').dateFnsLocale.code).toBe('de-AT');
    expect(resolveLocale('en-GB').dateFnsLocale.code).toBe('en-GB');
    // No de-CH in date-fns -> falls to plain de.
    expect(resolveLocale('de-CH').dateFnsLocale.code).toBe('de');
    expect(resolveLocale('fr-FR').dateFnsLocale.code).toBe('fr');
  });

  it('falls back to en/enUS for unknown, legacy, and nullish values', () => {
    for (const v of ['xx-XX', 'de', '', null, undefined]) {
      expect(resolveLocale(v)).toBe(DEFAULT_RESOLVED);
    }
  });
});

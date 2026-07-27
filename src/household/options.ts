/**
 * The allowed values for the household's `timezone` and `locale`.
 *
 * Both settings used to be free text, which made it easy to leave the timezone
 * wrong — and `household.timezone` drives To Do/calendar date semantics, so a
 * typo lands completions and due dates on the wrong local day. These lists are
 * the single source of truth: `PATCH /api/v1/household` validates against them
 * and the settings UI populates its `<select>`s from `GET /api/v1/household/options`,
 * so the two can never drift.
 */

/**
 * IANA zones this runtime can actually resolve, plus `UTC` (the seeded default,
 * which ICU does not report in `supportedValuesOf`). Built once at import time.
 * The exact set is ICU-version dependent — hence serving it to the client
 * rather than duplicating a hand-maintained copy in the web app.
 */
export const SUPPORTED_TIMEZONES: readonly string[] = Object.freeze([
  'UTC',
  ...Intl.supportedValuesOf('timeZone').filter((z) => z !== 'UTC'),
]);

const TIMEZONE_SET = new Set(SUPPORTED_TIMEZONES);

export interface LocaleOption {
  value: string;
  label: string;
}

/**
 * Supported display locales. The web app ships en + de message catalogues
 * (web/src/i18n) and maps every value here to a catalogue language plus a
 * date-fns locale (web/src/i18n/locale-map.ts) — a curated set rather than
 * every BCP-47 tag. Adding a value here requires a matching entry in that map.
 */
export const SUPPORTED_LOCALES: readonly LocaleOption[] = Object.freeze([
  { value: 'da-DK', label: 'Dansk (Danmark)' },
  { value: 'de-AT', label: 'Deutsch (Österreich)' },
  { value: 'de-CH', label: 'Deutsch (Schweiz)' },
  { value: 'de-DE', label: 'Deutsch (Deutschland)' },
  { value: 'en-AU', label: 'English (Australia)' },
  { value: 'en-CA', label: 'English (Canada)' },
  { value: 'en-GB', label: 'English (United Kingdom)' },
  { value: 'en-US', label: 'English (United States)' },
  { value: 'es-ES', label: 'Español (España)' },
  { value: 'fi-FI', label: 'Suomi (Suomi)' },
  { value: 'fr-FR', label: 'Français (France)' },
  { value: 'it-IT', label: 'Italiano (Italia)' },
  { value: 'nb-NO', label: 'Norsk bokmål (Norge)' },
  { value: 'nl-NL', label: 'Nederlands (Nederland)' },
  { value: 'pl-PL', label: 'Polski (Polska)' },
  { value: 'pt-PT', label: 'Português (Portugal)' },
  { value: 'sv-SE', label: 'Svenska (Sverige)' },
]);

const LOCALE_SET = new Set(SUPPORTED_LOCALES.map((l) => l.value));

export function isSupportedTimezone(zone: string): boolean {
  return TIMEZONE_SET.has(zone);
}

export function isSupportedLocale(locale: string): boolean {
  return LOCALE_SET.has(locale);
}

/** Payload for `GET /api/v1/household/options`. */
export function householdOptions() {
  return { timezones: SUPPORTED_TIMEZONES, locales: SUPPORTED_LOCALES };
}

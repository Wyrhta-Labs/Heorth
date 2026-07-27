import type { Locale } from 'date-fns';
import {
  da, de, deAT, enAU, enCA, enGB, enUS, es, fi, fr, it, nb, nl, pl, pt, sv,
} from 'date-fns/locale';

export type CatalogLanguage = 'en' | 'de';

export interface ResolvedLocale {
  /** Which message catalog to use (we ship en + de). */
  language: CatalogLanguage;
  /** Closest date-fns locale — regions without their own module fall to the base language. */
  dateFnsLocale: Locale;
}

export const DEFAULT_RESOLVED: ResolvedLocale = { language: 'en', dateFnsLocale: enUS };

// Keys mirror SUPPORTED_LOCALES in src/household/options.ts. date-fns 4.4.0
// has no de-CH / fr-FR / es-ES / it-IT / pt-PT / nl-NL / da-DK / fi-FI /
// nb-NO / pl-PL / sv-SE region modules, so those map to the base locale.
const MAP: Record<string, ResolvedLocale> = {
  'da-DK': { language: 'en', dateFnsLocale: da },
  'de-AT': { language: 'de', dateFnsLocale: deAT },
  'de-CH': { language: 'de', dateFnsLocale: de },
  'de-DE': { language: 'de', dateFnsLocale: de },
  'en-AU': { language: 'en', dateFnsLocale: enAU },
  'en-CA': { language: 'en', dateFnsLocale: enCA },
  'en-GB': { language: 'en', dateFnsLocale: enGB },
  'en-US': { language: 'en', dateFnsLocale: enUS },
  'es-ES': { language: 'en', dateFnsLocale: es },
  'fi-FI': { language: 'en', dateFnsLocale: fi },
  'fr-FR': { language: 'en', dateFnsLocale: fr },
  'it-IT': { language: 'en', dateFnsLocale: it },
  'nb-NO': { language: 'en', dateFnsLocale: nb },
  'nl-NL': { language: 'en', dateFnsLocale: nl },
  'pl-PL': { language: 'en', dateFnsLocale: pl },
  'pt-PT': { language: 'en', dateFnsLocale: pt },
  'sv-SE': { language: 'en', dateFnsLocale: sv },
};

export function resolveLocale(locale: string | null | undefined): ResolvedLocale {
  return (locale && MAP[locale]) || DEFAULT_RESOLVED;
}

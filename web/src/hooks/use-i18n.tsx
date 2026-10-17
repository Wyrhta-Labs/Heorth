import React, { createContext, useContext, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Locale } from 'date-fns';
import i18n from '@/i18n';
import { resolveLocale, DEFAULT_RESOLVED } from '@/i18n/locale-map';
import { QUERY_KEYS } from '@/lib/constants';
import { getHousehold } from '@/api/household';
import { useAuth } from '@/hooks/use-auth';
import { applyTheme } from '@/lib/theme';

// Safe default (enUS): components rendered outside the provider — most tests —
// format in English instead of throwing.
const DateFnsLocaleContext = createContext<Locale>(DEFAULT_RESOLVED.dateFnsLocale);
// Same reasoning: USD pairs with the enUS default until the household says otherwise.
const DEFAULT_CURRENCY = 'USD';
const CurrencyContext = createContext<string>(DEFAULT_CURRENCY);

/**
 * Applies household.locale, household.currency and household.theme app-wide: i18next language
 * (en/de catalogs), plus the date-fns locale and money currency for useFormatters(). The household query is GATED ON AUTH —
 * the API client clears the stored token on 401, so an ungated query on /login
 * would log people out as a side effect. Logout hard-navigates (full reload),
 * which resets everything to the en/enUS defaults.
 */
export function I18nProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  const { data } = useQuery({
    queryKey: QUERY_KEYS.household,
    queryFn: () => getHousehold(),
    enabled: isAuthenticated,
  });

  const resolved = isAuthenticated && data ? resolveLocale(data.data.locale) : DEFAULT_RESOLVED;
  const currency = isAuthenticated && data ? data.data.currency : DEFAULT_CURRENCY;

  useEffect(() => {
    if (i18n.language !== resolved.language) void i18n.changeLanguage(resolved.language);
  }, [resolved.language]);

  // household.theme rides on the same query. Logged out, the page keeps the
  // theme main.tsx restored from localStorage rather than snapping to hearth.
  const theme = isAuthenticated && data ? data.data.theme : undefined;
  useEffect(() => {
    if (theme !== undefined) applyTheme(theme);
  }, [theme]);

  return (
    <DateFnsLocaleContext.Provider value={resolved.dateFnsLocale}>
      <CurrencyContext.Provider value={currency}>
        {children}
      </CurrencyContext.Provider>
    </DateFnsLocaleContext.Provider>
  );
}

export function useDateFnsLocale(): Locale {
  return useContext(DateFnsLocaleContext);
}

/** The household's one currency (ISO 4217) for money formatting. */
export function useHouseholdCurrency(): string {
  return useContext(CurrencyContext);
}

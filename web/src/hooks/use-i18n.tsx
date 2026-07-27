import React, { createContext, useContext, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Locale } from 'date-fns';
import i18n from '@/i18n';
import { resolveLocale, DEFAULT_RESOLVED } from '@/i18n/locale-map';
import { QUERY_KEYS } from '@/lib/constants';
import { getHousehold } from '@/api/household';
import { useAuth } from '@/hooks/use-auth';

// Safe default (enUS): components rendered outside the provider — most tests —
// format in English instead of throwing.
const DateFnsLocaleContext = createContext<Locale>(DEFAULT_RESOLVED.dateFnsLocale);

/**
 * Applies household.locale app-wide: i18next language (en/de catalogs) and the
 * date-fns locale for useFormatters(). The household query is GATED ON AUTH —
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

  useEffect(() => {
    if (i18n.language !== resolved.language) void i18n.changeLanguage(resolved.language);
  }, [resolved.language]);

  return (
    <DateFnsLocaleContext.Provider value={resolved.dateFnsLocale}>
      {children}
    </DateFnsLocaleContext.Provider>
  );
}

export function useDateFnsLocale(): Locale {
  return useContext(DateFnsLocaleContext);
}

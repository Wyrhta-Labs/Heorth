import { useMemo } from 'react';
import { useDateFnsLocale, useHouseholdCurrency } from '@/hooks/use-i18n';
import * as fmt from '@/lib/format';

/** lib/format with the household's date-fns locale and currency pre-applied. */
export function useFormatters() {
  const locale = useDateFnsLocale();
  const currency = useHouseholdCurrency();
  return useMemo(() => ({
    locale,
    formatMoney: (v: string | number | null | undefined) => fmt.formatMoney(v, locale, currency),
    formatDate: (d: string | null | undefined, timeZone?: string) => fmt.formatDate(d, locale, timeZone),
    formatTime: (d: string | null | undefined, timeZone?: string) => fmt.formatTime(d, locale, timeZone),
    weekDays: (ref?: Date) => fmt.weekDays(ref),
    dayLabel: (d: Date) => fmt.dayLabel(d, locale),
  }), [locale, currency]);
}

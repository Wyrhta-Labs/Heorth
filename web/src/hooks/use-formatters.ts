import { useMemo } from 'react';
import { useDateFnsLocale } from '@/hooks/use-i18n';
import * as fmt from '@/lib/format';

/** lib/format with the household's date-fns locale pre-applied. */
export function useFormatters() {
  const locale = useDateFnsLocale();
  return useMemo(() => ({
    locale,
    formatMoney: (v: string | number | null | undefined) => fmt.formatMoney(v, locale),
    formatDate: (d: string | null | undefined) => fmt.formatDate(d, locale),
    formatTime: (d: string | null | undefined) => fmt.formatTime(d, locale),
    weekDays: (ref?: Date) => fmt.weekDays(ref, locale),
    dayLabel: (d: Date) => fmt.dayLabel(d, locale),
  }), [locale]);
}

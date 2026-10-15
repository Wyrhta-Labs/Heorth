import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { parseISO } from 'date-fns';
import { useFormatters } from '@/hooks/use-formatters';
import { useHouseholdZone, useHouseholdToday } from '@/hooks/use-household-zone';
import { addDaysIso } from '@/lib/format';
import { DAY_STRIP_SPAN } from '@/lib/day-focus';

/** Today and the six days after it. A rolling window rather than the calendar
 *  week: on a Sunday the calendar week is all behind you, and the week ahead
 *  is what matters. With `onSelect` the days are buttons that focus the page
 *  on that day. */
export default function DayStrip({ selected, onSelect }: { selected?: string; onSelect?: (iso: string) => void }) {
  const { t } = useTranslation();
  const { dayLabel } = useFormatters();
  // The household's today, not the browser's; no days until its zone is known.
  const { zone, ready } = useHouseholdZone();
  const todayIso = useHouseholdToday(zone);
  if (!ready) return <div className="min-h-20" aria-busy="true" />;
  const days = Array.from({ length: DAY_STRIP_SPAN }, (_, i) => addDaysIso(todayIso, i));
  return (
    <div className="grid grid-cols-7 gap-2">
      {days.map((iso) => {
        const { dow, dom } = dayLabel(parseISO(iso));
        const isToday = iso === todayIso;
        const isSelected = selected ? iso === selected : isToday;
        const cell = {
          'data-testid': 'day-strip-cell',
          'data-iso': iso,
          'data-today': isToday ? 'true' : undefined,
          'aria-current': isToday ? ('date' as const) : undefined,
          className: cn(
            'flex flex-col items-center rounded-xl border py-3 transition-colors',
            isSelected ? 'border-ember bg-ember/10' : 'border-tan bg-card',
            onSelect && !isSelected && 'hover:border-ember',
          ),
        };
        const label = (
          <>
            <span className="text-[11px] uppercase tracking-wide text-ash">{dow}</span>
            <span className={cn('font-serif text-xl', isToday ? 'text-ember' : 'text-ink')}>{dom}</span>
            {/* The real today stays marked whichever day is selected; the other
                days reserve the space so the cells line up. */}
            <span
              data-today-marker={isToday ? 'true' : undefined}
              className={cn('mt-1 h-1.5 w-1.5 rounded-full', isToday ? 'bg-ember' : 'bg-transparent')}
              aria-hidden
            />
            {isToday && <span className="sr-only">{t('today.title')}</span>}
          </>
        );
        return onSelect ? (
          <button key={iso} type="button" aria-pressed={isSelected} onClick={() => onSelect(iso)} {...cell}>
            {label}
          </button>
        ) : (
          <div key={iso} {...cell}>{label}</div>
        );
      })}
    </div>
  );
}

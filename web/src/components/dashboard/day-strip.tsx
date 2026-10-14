import { cn } from '@/lib/utils';
import { parseISO } from 'date-fns';
import { useFormatters } from '@/hooks/use-formatters';
import { useHouseholdZone, useHouseholdToday } from '@/hooks/use-household-zone';
import { addDaysIso } from '@/lib/format';

/** Today and the six days after it. A rolling window rather than the calendar
 *  week: on a Sunday the calendar week is all behind you, and the week ahead
 *  is what matters. */
export default function DayStrip({ selected }: { selected?: string }) {
  const { dayLabel } = useFormatters();
  // The household's today, not the browser's; no days until its zone is known.
  const { zone, ready } = useHouseholdZone();
  const todayIso = useHouseholdToday(zone);
  if (!ready) return <div className="min-h-20" aria-busy="true" />;
  const days = Array.from({ length: 7 }, (_, i) => addDaysIso(todayIso, i));
  return (
    <div className="grid grid-cols-7 gap-2">
      {days.map((iso) => {
        const { dow, dom } = dayLabel(parseISO(iso));
        const isToday = iso === todayIso;
        const isSelected = selected ? iso === selected : isToday;
        return (
          <div
            key={iso}
            data-testid="day-strip-cell"
            data-iso={iso}
            data-today={isToday ? 'true' : undefined}
            className={cn(
              'flex flex-col items-center rounded-xl border py-3 transition-colors',
              isSelected ? 'border-ember bg-ember/10' : 'border-tan bg-card',
            )}
          >
            <span className="text-[11px] uppercase tracking-wide text-ash">{dow}</span>
            <span className={cn('font-serif text-xl', isToday ? 'text-ember' : 'text-ink')}>{dom}</span>
          </div>
        );
      })}
    </div>
  );
}

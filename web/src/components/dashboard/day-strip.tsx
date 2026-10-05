import { cn } from '@/lib/utils';
import { useFormatters } from '@/hooks/use-formatters';

/** Today and the six days after it. A rolling window rather than the calendar
 *  week: on a Sunday the calendar week is all behind you, and the week ahead
 *  is what matters. */
export default function DayStrip({ selected }: { selected?: string }) {
  const { nextDays, dayLabel } = useFormatters();
  const days = nextDays();
  const todayIso = dayLabel(new Date()).iso;
  return (
    <div className="grid grid-cols-7 gap-2">
      {days.map((d) => {
        const { dow, dom, iso } = dayLabel(d);
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

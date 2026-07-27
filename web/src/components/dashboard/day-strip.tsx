import { cn } from '@/lib/utils';
import { useFormatters } from '@/hooks/use-formatters';

export default function DayStrip({ selected }: { selected?: string }) {
  const { weekDays, dayLabel } = useFormatters();
  const days = weekDays();
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

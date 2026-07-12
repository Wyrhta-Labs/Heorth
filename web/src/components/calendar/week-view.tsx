import { weekDays, dayLabel, formatTime } from '@/lib/format';
import { groupByDay } from '@/lib/calendar-grid';
import type { EventOccurrence } from '@/lib/types';

interface Props { occurrences: EventOccurrence[]; onSelect: (o: EventOccurrence) => void; }

export default function WeekView({ occurrences, onSelect }: Props) {
  const days = weekDays();
  const byDay = groupByDay(occurrences);
  return (
    <div className="grid grid-cols-7 gap-2">
      {days.map((d) => {
        const { dow, dom, iso } = dayLabel(d);
        return (
          <div key={iso} className="min-h-40 rounded-xl border border-tan bg-card p-2">
            <div className="mb-2 text-center">
              <div className="text-[11px] uppercase text-ash">{dow}</div>
              <div className="font-serif text-lg">{dom}</div>
            </div>
            <div className="space-y-1">
              {(byDay[iso] ?? []).map((o) => (
                <button key={`${o.id}-${o.occurrenceStart}`} onClick={() => onSelect(o)}
                  className="w-full truncate rounded-md bg-ember/10 px-2 py-1 text-left text-xs text-ink hover:bg-ember/20">
                  <span className="text-ember">{o.allDay ? '' : formatTime(o.occurrenceStart) + ' '}</span>{o.title}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

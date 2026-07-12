import { monthGrid, groupByDay } from '@/lib/calendar-grid';
import type { EventOccurrence } from '@/lib/types';

interface Props { year: number; month0: number; occurrences: EventOccurrence[]; onSelect: (o: EventOccurrence) => void; }
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function MonthView({ year, month0, occurrences, onSelect }: Props) {
  const grid = monthGrid(year, month0);
  const byDay = groupByDay(occurrences);
  return (
    <div>
      <div className="grid grid-cols-7 gap-2 mb-2">
        {DOW.map((d) => <div key={d} className="text-center text-[11px] uppercase text-ash">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-2">
        {grid.flat().map((iso) => {
          const inMonth = Number(iso.slice(5, 7)) === month0 + 1;
          return (
            <div key={iso} className={`min-h-24 rounded-lg border p-1.5 ${inMonth ? 'border-tan bg-card' : 'border-tan/50 bg-card/40'}`}>
              <div className={`text-xs mb-1 ${inMonth ? 'text-ink' : 'text-ash/60'}`}>{Number(iso.slice(8, 10))}</div>
              <div className="space-y-0.5">
                {(byDay[iso] ?? []).slice(0, 3).map((o) => (
                  <button key={`${o.id}-${o.occurrenceStart}`} onClick={() => onSelect(o)}
                    className="block w-full truncate rounded bg-ember/10 px-1 text-left text-[11px] hover:bg-ember/20">{o.title}</button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

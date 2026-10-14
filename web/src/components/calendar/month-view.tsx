import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { monthGrid, groupByDay } from '@/lib/calendar-grid';
import { isMirroredEvent, type EventOccurrence } from '@/lib/types';
import { useFormatters } from '@/hooks/use-formatters';

interface Props {
  /** The household month shown (`month0` is 0-based). */
  year: number;
  month0: number;
  /** The household's today, marked as the current date. */
  todayIso: string;
  /** The household's IANA zone: events are bucketed into its days. */
  timeZone: string;
  occurrences: EventOccurrence[];
  onSelect: (o: EventOccurrence) => void;
}

export default function MonthView({ year, month0, todayIso, timeZone, occurrences, onSelect }: Props) {
  const { t } = useTranslation();
  const { locale } = useFormatters();
  const grid = monthGrid(year, month0);
  const dowLabels = grid[0]!.map((iso) => format(new Date(iso + 'T00:00:00'), 'EEE', { locale }));
  const byDay = groupByDay(occurrences, timeZone);
  return (
    <div>
      <div className="grid grid-cols-7 gap-2 mb-2">
        {dowLabels.map((d, i) => <div key={`${d}-${i}`} className="text-center text-[11px] uppercase text-ash">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-2">
        {grid.flat().map((iso) => {
          const inMonth = Number(iso.slice(5, 7)) === month0 + 1;
          const isToday = iso === todayIso;
          return (
            <div key={iso} data-calendar-day={iso} aria-current={isToday ? 'date' : undefined}
              className={`min-h-24 rounded-lg border p-1.5 ${isToday ? 'border-ember bg-card' : inMonth ? 'border-tan bg-card' : 'border-tan/50 bg-card/40'}`}>
              <div className={`text-xs mb-1 ${isToday ? 'text-ember' : inMonth ? 'text-ink' : 'text-ash/60'}`}>{Number(iso.slice(8, 10))}</div>
              <div className="space-y-0.5">
                {(byDay[iso] ?? []).slice(0, 3).map((o) => (
                  isMirroredEvent(o) ? (
                    <div key={`${o.id}-${o.occurrenceStart}`}
                      title={o.organizer ? t('calendar.mirroredTitleWithOrganizer', { organizer: o.organizer }) : t('calendar.mirroredTitle')}
                      className="flex items-center gap-1 w-full truncate rounded border border-dashed border-sky/50 bg-sky/5 px-1 text-left text-[11px] text-ash">
                      <span className="h-1 w-1 shrink-0 rounded-full bg-sky" aria-hidden />
                      <span className="truncate">{o.title}</span>
                    </div>
                  ) : (
                    <button key={`${o.id}-${o.occurrenceStart}`} onClick={() => onSelect(o)}
                      className="block w-full truncate rounded bg-ember/10 px-1 text-left text-[11px] hover:bg-ember/20">{o.title}</button>
                  )
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

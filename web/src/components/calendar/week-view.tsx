import { useTranslation } from 'react-i18next';
import { useFormatters } from '@/hooks/use-formatters';
import { groupByDay } from '@/lib/calendar-grid';
import { isMirroredEvent, type EventOccurrence } from '@/lib/types';

interface Props { occurrences: EventOccurrence[]; onSelect: (o: EventOccurrence) => void; }

export default function WeekView({ occurrences, onSelect }: Props) {
  const { t } = useTranslation();
  const { weekDays, dayLabel, formatTime } = useFormatters();
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
              {(byDay[iso] ?? []).map((o) => {
                const time = <span className="text-ember">{o.allDay ? '' : formatTime(o.occurrenceStart) + ' '}</span>;
                // Mirrored (external) events are read-only: rendered as a static
                // chip with a subtle source marker and no click-to-edit.
                if (isMirroredEvent(o)) {
                  return (
                    <div key={`${o.id}-${o.occurrenceStart}`}
                      title={o.organizer ? t('calendar.mirroredTitleWithOrganizer', { organizer: o.organizer }) : t('calendar.mirroredTitle')}
                      className="flex items-center gap-1 w-full truncate rounded-md border border-dashed border-sky/50 bg-sky/5 px-2 py-1 text-left text-xs text-ash">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-sky" aria-hidden />
                      <span className="truncate">{time}{o.title}</span>
                    </div>
                  );
                }
                return (
                  <button key={`${o.id}-${o.occurrenceStart}`} onClick={() => onSelect(o)}
                    className="w-full truncate rounded-md bg-ember/10 px-2 py-1 text-left text-xs text-ink hover:bg-ember/20">
                    {time}{o.title}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

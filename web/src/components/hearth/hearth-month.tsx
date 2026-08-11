import { format } from 'date-fns';
import { Bell, Cake } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useFormatters } from '@/hooks/use-formatters';
import { monthGrid } from '@/lib/calendar-grid';
import { composeDay, remindersForDay, resolveAttribution, type StalenessInfo } from '@/lib/hearth';
import type { EventOccurrence, KithReminder, MealPlanEntry, Member, Recipe, Task } from '@/lib/types';

/** Reminders per month cell are capped separately from events (cells must not overflow). */
const MONTH_REMINDER_CAP = 2;

interface Props {
  year: number;
  month0: number;
  todayIso: string;
  occurrences: EventOccurrence[];
  entries: MealPlanEntry[];
  tasks: Task[];
  /** KithLedger reminders for the visible range (empty/omitted → nothing renders). */
  reminders?: KithReminder[];
  membersById: Record<string, Member>;
  recipesById: Record<string, Recipe>;
  staleByOwner: Record<string, StalenessInfo>;
  /** A day cell was tapped — open the add-event overlay for that day. */
  onAddEvent?: (iso: string) => void;
}

/** A calm, glanceable month: coloured event lines + a supper marker per day. Tap a day to add an event. */
export default function HearthMonth({ year, month0, todayIso, occurrences, entries, tasks, reminders = [], membersById, recipesById, staleByOwner, onAddEvent }: Props) {
  const { t } = useTranslation();
  const { locale } = useFormatters();
  const grid = monthGrid(year, month0, locale);
  const dowLabels = grid[0]!.map((iso) => format(new Date(iso + 'T00:00:00'), 'EEE', { locale }));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-2 grid grid-cols-7 gap-3">
        {dowLabels.map((d, i) => <div key={`${d}-${i}`} className="text-center text-sm uppercase tracking-wide text-ash">{d}</div>)}
      </div>
      <div className="grid min-h-0 flex-1 grid-rows-6 gap-3">
        {grid.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 gap-3">
            {week.map((iso) => {
              const inMonth = Number(iso.slice(5, 7)) === month0 + 1;
              const isToday = iso === todayIso;
              const comp = composeDay(iso, occurrences, entries, tasks, todayIso);
              const supper = comp.supper?.recipeId ? recipesById[comp.supper.recipeId]?.title : comp.supper?.freeText;
              const dayReminders = remindersForDay(reminders, iso);
              return (
                <div
                  key={iso}
                  data-hearth-month-day={iso}
                  onClick={onAddEvent ? () => onAddEvent(iso) : undefined}
                  className={[
                    'flex min-h-0 flex-col overflow-hidden rounded-xl border p-2',
                    isToday ? 'border-ember bg-card' : inMonth ? 'border-tan bg-card/60' : 'border-tan/40 bg-card/30',
                  ].join(' ')}
                >
                  <div className={`mb-1 font-serif text-xl leading-none ${isToday ? 'text-ember' : inMonth ? 'text-ink' : 'text-ash/50'}`}>
                    {Number(iso.slice(8, 10))}
                  </div>
                  <div className="min-h-0 flex-1 space-y-0.5 overflow-hidden">
                    {comp.events.slice(0, 3).map((o) => {
                      const attr = resolveAttribution(o, membersById);
                      const owner = attr.kind === 'family' ? 'family' : attr.memberId;
                      const dim = owner ? staleByOwner[owner]?.stale : false;
                      // All-day events read as a filled pill (title on a tint of the
                      // attribution colour); timed events keep the dot + title row.
                      if (o.allDay) {
                        return (
                          <div
                            key={`${o.id}-${o.occurrenceStart}`}
                            data-allday
                            className={`truncate rounded-full px-1.5 text-sm text-ink ${dim ? 'opacity-40' : ''}`}
                            style={{ backgroundColor: `${attr.color}33` }}
                          >
                            {o.title}
                          </div>
                        );
                      }
                      return (
                        <div key={`${o.id}-${o.occurrenceStart}`} className={`flex items-center gap-1 truncate text-sm ${dim ? 'opacity-40' : ''}`}>
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: attr.color }} aria-hidden />
                          <span className="truncate text-ink">{o.title}</span>
                        </div>
                      );
                    })}
                    {comp.events.length > 3 && <div className="text-xs text-ash/70">{t('hearth.day.more', { count: comp.events.length - 3 })}</div>}
                    {/* KithLedger reminders: icon + title row, visibly not an
                        event (no colour dot, no pill), capped on its own. */}
                    {dayReminders.slice(0, MONTH_REMINDER_CAP).map((r) => (
                      <div key={r.id} data-hearth-reminder={r.id} className="flex items-center gap-1 truncate text-sm text-ash">
                        {r.kind === 'birthday'
                          ? <Cake className="h-3.5 w-3.5 shrink-0 text-ember" aria-hidden />
                          : <Bell className="h-3.5 w-3.5 shrink-0 text-ember" aria-hidden />}
                        <span className="truncate">{r.title}</span>
                      </div>
                    ))}
                    {dayReminders.length > MONTH_REMINDER_CAP && (
                      <div className="text-xs text-ash/70">{t('hearth.day.more', { count: dayReminders.length - MONTH_REMINDER_CAP })}</div>
                    )}
                  </div>
                  {supper && (
                    <div className="mt-1 truncate text-sm text-ember" title={supper}>🍽 {supper}</div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

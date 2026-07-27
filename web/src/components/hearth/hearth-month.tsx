import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { useFormatters } from '@/hooks/use-formatters';
import { monthGrid } from '@/lib/calendar-grid';
import { composeDay, resolveAttribution, type StalenessInfo } from '@/lib/hearth';
import type { EventOccurrence, MealPlanEntry, Member, Recipe, Task } from '@/lib/types';

interface Props {
  year: number;
  month0: number;
  todayIso: string;
  occurrences: EventOccurrence[];
  entries: MealPlanEntry[];
  tasks: Task[];
  membersById: Record<string, Member>;
  recipesById: Record<string, Recipe>;
  staleByOwner: Record<string, StalenessInfo>;
}

/** A calm, glanceable month: coloured event lines + a supper marker per day. Read-only. */
export default function HearthMonth({ year, month0, todayIso, occurrences, entries, tasks, membersById, recipesById, staleByOwner }: Props) {
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
              return (
                <div
                  key={iso}
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
                      return (
                        <div key={`${o.id}-${o.occurrenceStart}`} className={`flex items-center gap-1 truncate text-sm ${dim ? 'opacity-40' : ''}`}>
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: attr.color }} aria-hidden />
                          <span className="truncate text-ink">{o.title}</span>
                        </div>
                      );
                    })}
                    {comp.events.length > 3 && <div className="text-xs text-ash/70">{t('hearth.day.more', { count: comp.events.length - 3 })}</div>}
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

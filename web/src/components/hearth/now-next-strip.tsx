import { CalendarClock, ListChecks, UtensilsCrossed } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useFormatters } from '@/hooks/use-formatters';
import { pickNowNext, resolveAttribution } from '@/lib/hearth';
import type { EventOccurrence, MealPlanEntry, Member, Recipe } from '@/lib/types';

interface Props {
  todayOccurrences: EventOccurrence[];
  supper: MealPlanEntry | null;
  dueTodayCount: number;
  nowMs: number;
  membersById: Record<string, Member>;
  recipesById: Record<string, Recipe>;
}

function Panel({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col rounded-2xl border border-tan bg-card/70 px-6 py-4">
      <div className="mb-1 flex items-center gap-2 text-sm uppercase tracking-wide text-ash">{icon}{label}</div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/**
 * Today's focus band across the top of the wall: what's on now (or next), what's
 * for supper tonight, and how many tasks are due today. Glance-only.
 */
export default function NowNextStrip({ todayOccurrences, supper, dueTodayCount, nowMs, membersById, recipesById }: Props) {
  const { t } = useTranslation();
  const { formatTime } = useFormatters();
  const { current, next } = pickNowNext(todayOccurrences, nowMs);
  const shown = current ?? next;
  const supperLabel = supper?.recipeId ? (recipesById[supper.recipeId]?.title ?? supper.freeText) : supper?.freeText;

  return (
    <div className="flex gap-4">
      <Panel icon={<CalendarClock className="h-4 w-4" />} label={current ? t('hearth.nowNext.happeningNow') : t('hearth.nowNext.upNext')}>
        {shown ? (
          <div className="flex items-baseline gap-3">
            <span className="shrink-0 font-serif text-2xl text-ember">
              {shown.allDay ? t('hearth.event.allDay') : formatTime(shown.occurrenceStart)}
            </span>
            <span className="min-w-0 truncate text-2xl text-ink">{shown.title}</span>
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: resolveAttribution(shown, membersById).color }} aria-hidden />
          </div>
        ) : (
          <span className="text-2xl text-ash/70">{t('hearth.nowNext.nothingMoreToday')}</span>
        )}
      </Panel>

      <Panel icon={<UtensilsCrossed className="h-4 w-4" />} label={t('hearth.nowNext.tonight')}>
        <span className="block truncate text-2xl text-ink">{supperLabel || <span className="text-ash/70">{t('hearth.nowNext.nothingPlanned')}</span>}</span>
      </Panel>

      <Panel icon={<ListChecks className="h-4 w-4" />} label={t('hearth.nowNext.dueToday')}>
        <span className="text-2xl text-ink">
          {dueTodayCount === 0 ? <span className="text-ash/70">{t('hearth.nowNext.allClear')}</span> : t('hearth.nowNext.tasks', { count: dueTodayCount })}
        </span>
      </Panel>
    </div>
  );
}

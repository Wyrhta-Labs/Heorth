import { useTranslation } from 'react-i18next';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { format, parseISO } from 'date-fns';
import { CalendarDays, House, ListChecks, Sunrise } from 'lucide-react';
import { SectionCard } from '@/components/ui/section-tone';
import DayStrip from '@/components/dashboard/day-strip';
import SupperCard from '@/components/dashboard/supper-card';
import Agenda from '@/components/dashboard/agenda';
import MembersRow from '@/components/dashboard/members-row';
import DueWork from '@/components/dashboard/due-work';
import { useFormatters } from '@/hooks/use-formatters';
import { useHouseholdZone, useHouseholdToday } from '@/hooks/use-household-zone';
import { focusDay } from '@/lib/day-focus';
import { addDaysIso } from '@/lib/format';

/**
 * "This week": the week strip, and below it one focused day — today unless a
 * day in the strip was picked (`?day=`). The agenda pair shows that day and the
 * day after it, supper is that day's, and the chores and tasks due on it are
 * highlighted.
 */
export default function DashboardPage() {
  const { t } = useTranslation();
  const { locale } = useFormatters();
  const navigate = useNavigate();
  const { day: requested } = useSearch({ strict: false });
  const { zone } = useHouseholdZone();
  const today = useHouseholdToday(zone);
  const day = focusDay(requested, today);
  const next = addDaysIso(day, 1);
  const tomorrow = addDaysIso(today, 1);

  const titleOf = (iso: string) =>
    iso === today ? t('today.title')
      : iso === tomorrow ? t('today.tomorrow')
        : format(parseISO(iso), t('dashboard.dayPattern'), { locale });
  // Today's own wording stays as it was; any other day is named.
  const emptyOf = (iso: string) =>
    iso === today ? undefined : iso === tomorrow ? t('today.noEventsTomorrow') : t('dashboard.noEventsOnDay', { day: titleOf(iso) });
  const errorOf = (iso: string) =>
    iso === today ? undefined : iso === tomorrow ? t('today.tomorrowLoadError') : t('dashboard.dayLoadError', { day: titleOf(iso) });

  const select = (iso: string) =>
    void navigate({ to: '/', search: iso === today ? {} : { day: iso }, replace: true });

  return (
    <div className="space-y-6">
      <DayStrip selected={day} onSelect={select} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <SupperCard day={day} label={day === today ? undefined : t('dashboard.supperOn', { day: titleOf(day) })} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <SectionCard title={titleOf(day)} icon={CalendarDays} tone="ember">
              <Agenda day={day} emptyMessage={emptyOf(day)} errorMessage={errorOf(day)} />
            </SectionCard>
            <SectionCard title={titleOf(next)} icon={Sunrise} tone="sky">
              <Agenda day={next} emptyMessage={emptyOf(next)} errorMessage={errorOf(next)} />
            </SectionCard>
          </div>
        </div>
        <div className="space-y-6">
          <SectionCard title={t('dashboard.work.title')} icon={ListChecks} tone="amber">
            <DueWork day={day} />
          </SectionCard>
          <SectionCard title={t('dashboard.home')} icon={House} tone="sage">
            <MembersRow />
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

import { useTranslation } from 'react-i18next';
import { addDays } from 'date-fns';
import { CalendarDays, ListChecks, Sunrise } from 'lucide-react';
import { SectionCard } from '@/components/ui/section-tone';
import DayStrip from '@/components/dashboard/day-strip';
import SupperCard from '@/components/dashboard/supper-card';
import Agenda from '@/components/dashboard/agenda';
import DueWork from '@/components/dashboard/due-work';

/**
 * Phone-first "Today": a compact stack — the next seven days, tonight's
 * supper, today's and tomorrow's agenda (native + mirrored M365 events, via
 * the shared Agenda widget), and what needs doing (due chores, open tasks).
 * Not the wall layout (that's /hearth) — narrower, single column,
 * thumb-scrollable.
 */
export default function TodayPage() {
  const { t } = useTranslation();
  return (
    <div className="space-y-4 max-w-md mx-auto">
      <DayStrip />
      <SupperCard />
      <SectionCard title={t('today.title')} icon={CalendarDays} tone="ember">
        <Agenda />
      </SectionCard>
      <SectionCard title={t('today.tomorrow')} icon={Sunrise} tone="sky">
        <Agenda
          day={addDays(new Date(), 1)}
          emptyMessage={t('today.noEventsTomorrow')}
          errorMessage={t('today.tomorrowLoadError')}
        />
      </SectionCard>
      <SectionCard title={t('dashboard.work.title')} icon={ListChecks} tone="amber">
        <DueWork />
      </SectionCard>
    </div>
  );
}

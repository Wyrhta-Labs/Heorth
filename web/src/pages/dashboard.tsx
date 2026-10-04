import { useTranslation } from 'react-i18next';
import { addDays } from 'date-fns';
import { CalendarDays, House, ListChecks, Sunrise } from 'lucide-react';
import { SectionCard } from '@/components/ui/section-tone';
import DayStrip from '@/components/dashboard/day-strip';
import SupperCard from '@/components/dashboard/supper-card';
import Agenda from '@/components/dashboard/agenda';
import MembersRow from '@/components/dashboard/members-row';
import DueWork from '@/components/dashboard/due-work';

export default function DashboardPage() {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <DayStrip />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <SupperCard />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
          </div>
        </div>
        <div className="space-y-6">
          <SectionCard title={t('dashboard.work.title')} icon={ListChecks} tone="amber">
            <DueWork />
          </SectionCard>
          <SectionCard title={t('dashboard.home')} icon={House} tone="sage">
            <MembersRow />
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

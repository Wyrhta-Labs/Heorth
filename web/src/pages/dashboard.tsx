import { useTranslation } from 'react-i18next';
import { addDays } from 'date-fns';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
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
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">{t('today.title')}</CardTitle></CardHeader>
              <CardContent><Agenda /></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">{t('today.tomorrow')}</CardTitle></CardHeader>
              <CardContent>
                <Agenda
                  day={addDays(new Date(), 1)}
                  emptyMessage={t('today.noEventsTomorrow')}
                  errorMessage={t('today.tomorrowLoadError')}
                />
              </CardContent>
            </Card>
          </div>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">{t('dashboard.work.title')}</CardTitle></CardHeader>
            <CardContent><DueWork /></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">{t('dashboard.home')}</CardTitle></CardHeader>
            <CardContent><MembersRow /></CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

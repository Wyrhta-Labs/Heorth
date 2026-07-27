import { CheckCircle2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** RESERVED-BUT-EMPTY: the Chores module ships in a later phase (spec 0.1 non-goal).
 *  This keeps the dashboard's chores slot in the layout without any functionality. */
export default function ChoresSlot() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center h-full rounded-xl border border-dashed border-tan bg-card/50 py-10 text-center">
      <CheckCircle2 className="h-6 w-6 text-tan mb-2" />
      <div className="text-sm font-medium text-ash">{t('dashboard.chores.title')}</div>
      <div className="text-xs text-ash/70 mt-1">{t('dashboard.chores.comingSoon')}</div>
    </div>
  );
}

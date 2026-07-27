import { useTranslation } from 'react-i18next';
import { progressPercent } from '@/lib/format';
import { Progress } from '@/components/ui/progress';
import { useFormatters } from '@/hooks/use-formatters';
import type { MonthSummary } from '@/lib/types';

export default function SummaryHeader({ summary }: { summary: MonthSummary }) {
  const { t } = useTranslation();
  const { formatMoney } = useFormatters();
  const { totals } = summary;
  return (
    <div className="rounded-xl border border-tan bg-card p-6">
      <div className="text-sm text-ash">{t('feoh.thisMonth')}</div>
      <div className="mt-1 font-serif text-3xl text-ink">
        {formatMoney(totals.spent)} <span className="text-ash text-xl">{t('feoh.ofBudget', { amount: formatMoney(totals.budget) })}</span>
      </div>
      <div className="mt-3 max-w-md">
        <Progress value={progressPercent(totals.spent, totals.budget)} />
      </div>
    </div>
  );
}

import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { progressPercent } from '@/lib/format';
import { toneColor } from '@/lib/constants';
import { useFormatters } from '@/hooks/use-formatters';
import type { EnvelopeSummary } from '@/lib/types';

export default function EnvelopeCard({ envelope }: { envelope: EnvelopeSummary }) {
  const { t } = useTranslation();
  const { formatMoney } = useFormatters();
  const pct = progressPercent(envelope.spent, envelope.budget);
  const over = envelope.spent > envelope.budget;
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-baseline justify-between">
          <h4 className="font-serif text-lg text-ink">{envelope.name}</h4>
          <span className={`text-sm ${over ? 'text-red-600' : 'text-ash'}`}>
            {formatMoney(envelope.spent)} / {formatMoney(envelope.budget)}
          </span>
        </div>
        <div className="mt-3">
          <Progress value={pct} color={over ? '#c0392b' : toneColor(envelope.tone)} />
        </div>
        <div className="mt-1 text-xs text-ash">
          {over
            ? t('feoh.over', { amount: formatMoney(envelope.spent - envelope.budget) })
            : t('feoh.left', { amount: formatMoney(envelope.remaining) })}
        </div>
      </CardContent>
    </Card>
  );
}

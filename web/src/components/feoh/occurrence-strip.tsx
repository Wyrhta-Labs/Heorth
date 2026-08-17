import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useFormatters } from '@/hooks/use-formatters';
import {
  useOccurrences, useTransactions, useLinkOccurrence, useSkipOccurrence,
  useUnskipOccurrence, useUnlinkOccurrence, useOverrideOccurrence,
} from '@/hooks/use-feoh';
import type { OccurrenceEntry, OccurrenceStatus } from '@/lib/types';

const STATUS_VARIANT: Record<OccurrenceStatus, 'default' | 'success' | 'warning' | 'destructive' | 'secondary'> = {
  planned: 'default',
  paid: 'success',
  overdue: 'destructive',
  skipped: 'secondary',
  unknown: 'warning',
};

interface Props { billId: string; }

/** Per-bill strip: the next four occurrences (by due date) with status chips and actions. */
export default function OccurrenceStrip({ billId }: Props) {
  const { t } = useTranslation();
  const { formatMoney, formatDate } = useFormatters();
  const occurrencesQuery = useOccurrences({ billId });
  const transactionsQuery = useTransactions({ limit: 20 });
  const link = useLinkOccurrence();
  const skip = useSkipOccurrence();
  const unskip = useUnskipOccurrence();
  const unlink = useUnlinkOccurrence();
  const override = useOverrideOccurrence();

  const [bookingDueDate, setBookingDueDate] = useState<string | null>(null);
  const [pickedTx, setPickedTx] = useState('');
  const [editingDueDate, setEditingDueDate] = useState<string | null>(null);
  const [amountInput, setAmountInput] = useState('');

  const occurrences = (occurrencesQuery.data?.data ?? [])
    .slice()
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 4);
  const transactions = transactionsQuery.data?.data ?? [];

  const openBooking = (o: OccurrenceEntry) => { setBookingDueDate(o.dueDate); setPickedTx(''); setEditingDueDate(null); };
  const confirmBooking = (o: OccurrenceEntry) => {
    if (!pickedTx) return;
    link.mutate({ billId: o.billId, dueDate: o.dueDate, transactionId: pickedTx });
    setBookingDueDate(null);
  };
  const openAmountEdit = (o: OccurrenceEntry) => {
    setEditingDueDate(o.dueDate);
    setAmountInput(o.overrideAmount != null ? String(o.overrideAmount) : '');
    setBookingDueDate(null);
  };
  const confirmAmount = (o: OccurrenceEntry) => {
    const trimmed = amountInput.trim();
    override.mutate({ billId: o.billId, dueDate: o.dueDate, amount: trimmed === '' ? null : Number(trimmed) });
    setEditingDueDate(null);
  };

  if (occurrences.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {occurrences.map((o) => (
        <div key={o.dueDate} className="rounded-lg border border-tan bg-card px-2 py-1.5 text-xs space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-ash">{formatDate(o.dueDate)}</span>
            <Badge variant={STATUS_VARIANT[o.status]}>{t(`feoh.occurrences.status.${o.status}`)}</Badge>
            <span>{formatMoney(o.overrideAmount ?? o.expectedAmount)}</span>
          </div>

          {o.status !== 'unknown' && (
            <div className="flex flex-wrap gap-1">
              {!o.transactionId && (
                <Button variant="outline" size="sm" onClick={() => openBooking(o)}>{t('feoh.occurrences.link')}</Button>
              )}
              {o.transactionId && (
                <Button variant="outline" size="sm" onClick={() => unlink.mutate({ billId: o.billId, dueDate: o.dueDate })}>
                  {t('feoh.occurrences.unlink')}
                </Button>
              )}
              {o.status === 'skipped' ? (
                <Button variant="outline" size="sm" onClick={() => unskip.mutate({ billId: o.billId, dueDate: o.dueDate })}>
                  {t('feoh.occurrences.unskip')}
                </Button>
              ) : (
                o.status !== 'paid' && (
                  <Button variant="outline" size="sm" onClick={() => skip.mutate({ billId: o.billId, dueDate: o.dueDate })}>
                    {t('feoh.occurrences.skip')}
                  </Button>
                )
              )}
              <Button variant="outline" size="sm" onClick={() => openAmountEdit(o)}>{t('feoh.occurrences.override')}</Button>
            </div>
          )}

          {bookingDueDate === o.dueDate && (
            <div className="flex items-center gap-1 pt-1">
              <select
                aria-label={t('feoh.occurrences.pickTransaction')}
                value={pickedTx}
                onChange={(e) => setPickedTx(e.target.value)}
                className="h-8 rounded-md border border-tan bg-card px-2 text-xs"
              >
                <option value="">—</option>
                {transactions.map((tx) => (
                  <option key={tx.id} value={tx.id}>{tx.date} · {tx.payee} · {tx.amount}</option>
                ))}
              </select>
              <Button size="sm" onClick={() => confirmBooking(o)}>{t('common.confirm')}</Button>
            </div>
          )}

          {editingDueDate === o.dueDate && (
            <div className="flex items-center gap-1 pt-1">
              <Input
                aria-label={t('feoh.occurrences.override')}
                type="number" step="0.01"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                className="h-8 w-24"
              />
              <Button size="sm" onClick={() => confirmAmount(o)}>{t('common.confirm')}</Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** Section-level aggregate: how many occurrences (across all bills) are overdue. */
export function OverdueBadge() {
  const { t } = useTranslation();
  const occurrencesQuery = useOccurrences({ status: 'overdue' });
  const count = occurrencesQuery.data?.data.length ?? 0;
  if (count === 0) return null;
  return <Badge variant="destructive">{t('feoh.occurrences.overdueBadge', { count })}</Badge>;
}

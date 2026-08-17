import { useState } from 'react';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useEnvelopes, useReconcileAccount } from '@/hooks/use-feoh';
import { useFormatters } from '@/hooks/use-formatters';
import { ApiError } from '@/api/client';
import type { ReconcileResult } from '@/lib/types';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string;
}

/** Kassensturz: count the till, book the difference into an envelope. */
export default function ReconcileDialog({ open, onOpenChange, accountId }: Props) {
  const { t } = useTranslation();
  const { formatMoney } = useFormatters();
  const envQuery = useEnvelopes();
  const envelopes = envQuery.data?.data ?? [];
  const reconcile = useReconcileAccount();

  const [counted, setCounted] = useState('');
  const [date, setDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [envelopeId, setEnvelopeId] = useState('');
  const [memo, setMemo] = useState('');
  const [result, setResult] = useState<ReconcileResult | null>(null);
  const [error, setError] = useState('');

  const reset = () => {
    setCounted('');
    setDate(format(new Date(), 'yyyy-MM-dd'));
    setEnvelopeId('');
    setMemo('');
    setResult(null);
    setError('');
  };

  const close = () => {
    reset();
    onOpenChange(false);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const res = await reconcile.mutateAsync({
        id: accountId,
        input: { countedBalance: Number(counted), date, envelopeId, memo: memo || null },
      });
      setResult(res.data);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'LATER_TRANSACTIONS_EXIST') {
        setError(t('feoh.accounts.laterTransactions'));
      } else {
        setError((err as Error).message || t('feoh.recordFailed'));
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('feoh.accounts.reconcile')}</DialogTitle>
          <DialogClose onClose={close} />
        </DialogHeader>
        {result ? (
          <div className="space-y-3">
            <p className="text-sm text-ink">
              {result.difference === 0
                ? t('feoh.accounts.noDifference')
                : t('feoh.accounts.difference', { amount: formatMoney(result.difference) })}
            </p>
            <div className="flex justify-end"><Button onClick={close}>{t('feoh.form.cancel')}</Button></div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="reconcile-counted">{t('feoh.accounts.counted')}</Label>
              <Input
                id="reconcile-counted" type="number" step="0.01" value={counted}
                onChange={(e) => setCounted(e.target.value)} required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="reconcile-date">{t('feoh.form.date')}</Label>
              <Input id="reconcile-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="reconcile-envelope">{t('feoh.accounts.bookedAs')}</Label>
              <select
                id="reconcile-envelope" value={envelopeId} onChange={(e) => setEnvelopeId(e.target.value)}
                className="h-9 w-full rounded-md border border-tan bg-card px-3 text-sm"
              >
                <option value="">-</option>
                {envelopes.map((en) => <option key={en.id} value={en.id}>{en.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="reconcile-memo">{t('feoh.form.memo')}</Label>
              <Input id="reconcile-memo" value={memo} onChange={(e) => setMemo(e.target.value)} />
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={close}>{t('feoh.form.cancel')}</Button>
              <Button type="submit" disabled={reconcile.isPending}>
                {reconcile.isPending ? t('feoh.form.saving') : t('feoh.form.record')}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

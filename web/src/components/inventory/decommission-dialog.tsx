import { useState } from 'react';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { useDecommissionItem } from '@/hooks/use-inventory';
import { useCreateItemCost, useTransactions } from '@/hooks/use-feoh';
import type { InventoryItem, DecommissionReason } from '@/lib/types';

const REASONS: DecommissionReason[] = ['broken', 'sold', 'given_away', 'worn_out', 'lost', 'other'];

interface Props {
  item: InventoryItem | null;
  onClose: () => void;
}

/**
 * Decommission = decommissionItem, then (only if a sale transaction was
 * picked) createItemCost({kind:'disposal'}). The second call is non-fatal:
 * the item stays decommissioned even if linking the transaction fails, and we
 * just toast `linkFailed` so the household can retry the link later.
 */
export default function DecommissionDialog({ item, onClose }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const decommission = useDecommissionItem();
  const createCost = useCreateItemCost();
  const transactionsQuery = useTransactions({ limit: 20 });
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [reason, setReason] = useState<DecommissionReason>('broken');
  const [proceeds, setProceeds] = useState('');
  const [transactionId, setTransactionId] = useState('');
  const [error, setError] = useState('');

  const transactions = transactionsQuery.data?.data ?? [];

  const pickTransaction = (id: string) => {
    setTransactionId(id);
    const tx = transactions.find((x) => x.id === id);
    if (tx) setProceeds(tx.amount);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!item) return;
    setError('');
    try {
      await decommission.mutateAsync({
        id: item.id,
        input: { date, reason, proceeds: proceeds ? Number(proceeds) : undefined },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
      return;
    }
    onClose();
    if (transactionId) {
      try {
        await createCost.mutateAsync({ transactionId, itemId: item.id, kind: 'disposal' });
      } catch {
        toast(t('inventory.decommission.linkFailed'), 'error');
      }
    }
  };

  return (
    <Dialog open={!!item} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        {item && (
          <>
            <DialogHeader>
              <DialogTitle>{t('inventory.decommission.action')}</DialogTitle>
              <DialogClose onClose={onClose} />
            </DialogHeader>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label htmlFor="decom-date">{t('inventory.decommission.date')}</Label>
                  <Input id="decom-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="decom-reason">{t('inventory.decommission.reason')}</Label>
                  <select
                    id="decom-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value as DecommissionReason)}
                    className="h-9 w-full rounded-md border border-tan bg-card px-3 text-sm"
                  >
                    {REASONS.map((r) => <option key={r} value={r}>{t(`inventory.reasons.${r}`)}</option>)}
                  </select>
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="decom-proceeds">{t('inventory.decommission.proceeds')}</Label>
                <Input id="decom-proceeds" type="number" step="0.01" min="0" value={proceeds} onChange={(e) => setProceeds(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="decom-tx">{t('inventory.decommission.linkSale')}</Label>
                <select
                  id="decom-tx"
                  value={transactionId}
                  onChange={(e) => pickTransaction(e.target.value)}
                  className="h-9 w-full rounded-md border border-tan bg-card px-3 text-sm"
                >
                  <option value="">—</option>
                  {transactions.map((tx) => (
                    <option key={tx.id} value={tx.id}>{tx.date} · {tx.payee} · {tx.amount}</option>
                  ))}
                </select>
              </div>
              {error && <p className="text-xs text-red-600">{error}</p>}
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
                <Button type="submit" disabled={decommission.isPending}>
                  {decommission.isPending ? t('common.loading') : t('inventory.decommission.action')}
                </Button>
              </div>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

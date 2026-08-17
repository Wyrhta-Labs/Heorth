import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { useFormatters } from '@/hooks/use-formatters';
import { useItemCosts, useCreateItemCost, useTransactions } from '@/hooks/use-feoh';
import { useDeleteItem } from '@/hooks/use-inventory';
import { ApiError } from '@/api/client';
import DecommissionDialog from './decommission-dialog';
import { lifecycleLine } from './lifecycle';
import type { InventoryItem, ItemCostKind } from '@/lib/types';

const COST_KINDS: ItemCostKind[] = ['purchase', 'disposal', 'repair', 'maintenance', 'accessory'];

interface Props {
  item: InventoryItem | null;
  onClose: () => void;
}

export default function ItemDetail({ item, onClose }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { formatDate, formatMoney } = useFormatters();
  const costsQuery = useItemCosts(item?.id ?? '');
  const createCost = useCreateItemCost();
  const deleteItem = useDeleteItem();
  const transactionsQuery = useTransactions({ limit: 20 });
  const [decommissionOpen, setDecommissionOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkTransactionId, setLinkTransactionId] = useState('');
  const [linkKind, setLinkKind] = useState<ItemCostKind>('repair');

  if (!item) return null;

  const totals = costsQuery.data?.data.totals;
  const links = costsQuery.data?.data.links ?? [];
  const transactions = transactionsQuery.data?.data ?? [];
  const lifecycle = lifecycleLine(item, t, formatDate, formatMoney);

  const submitLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!linkTransactionId) return;
    try {
      await createCost.mutateAsync({ transactionId: linkTransactionId, itemId: item.id, kind: linkKind });
      setLinkOpen(false);
      setLinkTransactionId('');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'error');
    }
  };

  const handleDelete = async () => {
    if (!confirm(t('inventory.deleteConfirm', { name: item.name }))) return;
    try {
      await deleteItem.mutateAsync(item.id);
      toast(t('inventory.deleted'), 'success');
      onClose();
    } catch (e) {
      const msg = e instanceof ApiError && e.code === 'HAS_FINANCE_LINKS' ? t('inventory.deleteBlocked') : (e as Error).message;
      toast(msg || t('inventory.deleteFailed'), 'error');
    }
  };

  return (
    <>
      <Dialog open={!!item && !decommissionOpen} onOpenChange={(v) => !v && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{item.name}</DialogTitle>
            <DialogClose onClose={onClose} />
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <div className="space-y-1">
              <p className="text-muted-foreground">
                {[item.category, item.manufacturer, item.model].filter(Boolean).join(' · ') || '—'}
              </p>
              {item.location && <p>{t('inventory.fields.location')}: {item.location}</p>}
              {item.serialNumber && <p>{t('inventory.fields.serialNumber')}: {item.serialNumber}</p>}
              {item.notes && <p className="text-muted-foreground">{item.notes}</p>}
              {lifecycle && <p className="font-medium">{lifecycle}</p>}
            </div>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">{t('inventory.tco.title')}</CardTitle></CardHeader>
              <CardContent className="space-y-1">
                {totals ? (
                  <>
                    <div className="flex justify-between"><span>{t('inventory.tco.capital')}</span><span>{formatMoney(totals.capital)}</span></div>
                    <div className="flex justify-between"><span>{t('inventory.tco.tier2')}</span><span>{formatMoney(totals.tier2)}</span></div>
                    <div className="flex justify-between"><span>{t('inventory.tco.recurring')}</span><span>{formatMoney(totals.recurring)}</span></div>
                    <div className="flex justify-between"><span>{t('inventory.tco.proceeds')}</span><span>{formatMoney(totals.proceeds)}</span></div>
                    <div className="flex justify-between font-medium"><span>{t('inventory.tco.total')}</span><span>{formatMoney(totals.total)}</span></div>
                    <div className="flex justify-between">
                      <span>{t('inventory.tco.perYear')}</span>
                      <span>{totals.perYear === null ? '—' : formatMoney(totals.perYear)}</span>
                    </div>
                  </>
                ) : <p className="text-muted-foreground">{t('common.loading')}</p>}

                {links.length > 0 && (
                  <ul className="pt-2 space-y-1">
                    {links.map((link) => (
                      <li key={link.id} className="flex justify-between text-xs text-muted-foreground">
                        <span className="rounded-full bg-linen px-2 py-0.5">{t(`inventory.tco.kind.${link.kind}`)}</span>
                        <span>{link.transaction.payee} · {formatMoney(link.transaction.amount)}</span>
                      </li>
                    ))}
                  </ul>
                )}

                {!linkOpen ? (
                  <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => setLinkOpen(true)}>
                    {t('inventory.tco.linkExpense')}
                  </Button>
                ) : (
                  <form onSubmit={submitLink} className="mt-2 space-y-2">
                    <select
                      aria-label={t('inventory.tco.linkExpense')}
                      value={linkTransactionId}
                      onChange={(e) => setLinkTransactionId(e.target.value)}
                      className="h-9 w-full rounded-md border border-tan bg-card px-3 text-sm"
                    >
                      <option value="">—</option>
                      {transactions.map((tx) => (
                        <option key={tx.id} value={tx.id}>{tx.date} · {tx.payee} · {tx.amount}</option>
                      ))}
                    </select>
                    <select
                      value={linkKind}
                      onChange={(e) => setLinkKind(e.target.value as ItemCostKind)}
                      className="h-9 w-full rounded-md border border-tan bg-card px-3 text-sm"
                    >
                      {COST_KINDS.map((k) => <option key={k} value={k}>{t(`inventory.tco.kind.${k}`)}</option>)}
                    </select>
                    <div className="flex justify-end gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => setLinkOpen(false)}>{t('common.cancel')}</Button>
                      <Button type="submit" size="sm" disabled={createCost.isPending}>{t('common.save')}</Button>
                    </div>
                  </form>
                )}
              </CardContent>
            </Card>

            <div className="flex justify-between pt-2">
              <Button type="button" variant="outline" onClick={() => setDecommissionOpen(true)} disabled={!!item.decommissionedAt}>
                {t('inventory.decommission.action')}
              </Button>
              <Button type="button" variant="destructive" onClick={handleDelete} disabled={deleteItem.isPending}>
                {t('inventory.delete')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <DecommissionDialog item={decommissionOpen ? item : null} onClose={() => setDecommissionOpen(false)} />
    </>
  );
}

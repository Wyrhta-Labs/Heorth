import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { useFormatters } from '@/hooks/use-formatters';
import { useItemCosts, useCreateItemCost, useTransactions } from '@/hooks/use-feoh';
import { useDeleteAsset } from '@/hooks/use-ethel';
import { ApiError } from '@/api/client';
import DecommissionDialog from './decommission-dialog';
import { lifecycleLine } from './lifecycle';
import type { EthelAsset, ItemCostKind } from '@/lib/types';

const COST_KINDS: ItemCostKind[] = ['purchase', 'disposal', 'repair', 'maintenance', 'accessory'];

interface Props {
  asset: EthelAsset | null;
  onClose: () => void;
}

export default function AssetDetail({ asset, onClose }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { formatDate, formatMoney } = useFormatters();
  const costsQuery = useItemCosts(asset?.id ?? '');
  const createCost = useCreateItemCost();
  const deleteAsset = useDeleteAsset();
  const transactionsQuery = useTransactions({ limit: 20 });
  const [decommissionOpen, setDecommissionOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkTransactionId, setLinkTransactionId] = useState('');
  const [linkKind, setLinkKind] = useState<ItemCostKind>('repair');

  if (!asset) return null;

  const totals = costsQuery.data?.data.totals;
  const links = costsQuery.data?.data.links ?? [];
  const transactions = transactionsQuery.data?.data ?? [];
  const lifecycle = lifecycleLine(asset, t, formatDate, formatMoney);

  const submitLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!linkTransactionId) return;
    try {
      await createCost.mutateAsync({ transactionId: linkTransactionId, itemId: asset.id, kind: linkKind });
      setLinkOpen(false);
      setLinkTransactionId('');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'error');
    }
  };

  const handleDelete = async () => {
    if (!confirm(t('ethel.deleteConfirm', { name: asset.name }))) return;
    try {
      await deleteAsset.mutateAsync(asset.id);
      toast(t('ethel.deleted'), 'success');
      onClose();
    } catch (e) {
      const msg = e instanceof ApiError && e.code === 'HAS_FINANCE_LINKS' ? t('ethel.deleteBlocked') : (e as Error).message;
      toast(msg || t('ethel.deleteFailed'), 'error');
    }
  };

  return (
    <>
      <Dialog open={!!asset && !decommissionOpen} onOpenChange={(v) => !v && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{asset.name}</DialogTitle>
            <DialogClose onClose={onClose} />
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <div className="space-y-1">
              <p className="text-muted-foreground">
                {[asset.category, asset.manufacturer, asset.model].filter(Boolean).join(' · ') || '—'}
              </p>
              {asset.locationNote && <p>{t('ethel.fields.locationNote')}: {asset.locationNote}</p>}
              {asset.serialNumber && <p>{t('ethel.fields.serialNumber')}: {asset.serialNumber}</p>}
              {asset.notes && <p className="text-muted-foreground">{asset.notes}</p>}
              {lifecycle && <p className="font-medium">{lifecycle}</p>}
            </div>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">{t('ethel.tco.title')}</CardTitle></CardHeader>
              <CardContent className="space-y-1">
                {totals ? (
                  <>
                    <div className="flex justify-between"><span>{t('ethel.tco.capital')}</span><span>{formatMoney(totals.capital)}</span></div>
                    <div className="flex justify-between"><span>{t('ethel.tco.tier2')}</span><span>{formatMoney(totals.tier2)}</span></div>
                    <div className="flex justify-between"><span>{t('ethel.tco.recurring')}</span><span>{formatMoney(totals.recurring)}</span></div>
                    <div className="flex justify-between"><span>{t('ethel.tco.proceeds')}</span><span>{formatMoney(totals.proceeds)}</span></div>
                    <div className="flex justify-between font-medium"><span>{t('ethel.tco.total')}</span><span>{formatMoney(totals.total)}</span></div>
                    <div className="flex justify-between">
                      <span>{t('ethel.tco.perYear')}</span>
                      <span>{totals.perYear === null ? '—' : formatMoney(totals.perYear)}</span>
                    </div>
                  </>
                ) : <p className="text-muted-foreground">{t('common.loading')}</p>}

                {links.length > 0 && (
                  <ul className="pt-2 space-y-1">
                    {links.map((link) => (
                      <li key={link.id} className="flex justify-between text-xs text-muted-foreground">
                        <span className="rounded-full bg-linen px-2 py-0.5">{t(`ethel.tco.kind.${link.kind}`)}</span>
                        <span>{link.transaction.payee} · {formatMoney(link.transaction.amount)}</span>
                      </li>
                    ))}
                  </ul>
                )}

                {!linkOpen ? (
                  <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => setLinkOpen(true)}>
                    {t('ethel.tco.linkExpense')}
                  </Button>
                ) : (
                  <form onSubmit={submitLink} className="mt-2 space-y-2">
                    <select
                      aria-label={t('ethel.tco.linkExpense')}
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
                      {COST_KINDS.map((k) => <option key={k} value={k}>{t(`ethel.tco.kind.${k}`)}</option>)}
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
              <Button type="button" variant="outline" onClick={() => setDecommissionOpen(true)} disabled={!!asset.decommissionedAt}>
                {t('ethel.decommission.action')}
              </Button>
              <Button type="button" variant="destructive" onClick={handleDelete} disabled={deleteAsset.isPending}>
                {t('ethel.delete')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <DecommissionDialog asset={decommissionOpen ? asset : null} onClose={() => setDecommissionOpen(false)} />
    </>
  );
}

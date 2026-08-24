import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { useFormatters } from '@/hooks/use-formatters';
import { useItemCosts, useCreateItemCost, useTransactions } from '@/hooks/use-feoh';
import { useDeleteAsset, useAsset } from '@/hooks/use-ethel';
import { ApiError } from '@/api/client';
import DecommissionDialog from './decommission-dialog';
import VehicleDetails from './vehicle-details';
import FacilityDetails from './facility-details';
import { lifecycleLine } from './lifecycle';
import { placePath } from '@/lib/place-tree';
import type { EthelAsset, EthelPlace, ItemCostKind } from '@/lib/types';

const COST_KINDS: ItemCostKind[] = ['purchase', 'disposal', 'repair', 'maintenance', 'accessory'];

interface Props {
  asset: EthelAsset | null;
  /** The flat place set, so the panel can render the asset's place PATH. The
   *  payload carries `placeId` only — no denormalised name — so renaming a
   *  place rewrites no asset rows. */
  places?: EthelPlace[];
  onClose: () => void;
}

export default function AssetDetail({ asset, places = [], onClose }: Props) {
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
  // Which detail panel the member has OPENED for an asset that has neither.
  // An existing detail row shows its panel regardless of this.
  const [adding, setAdding] = useState<'vehicle' | 'facility' | null>(null);
  // The LIST row carries no details, so the panel reads the single-asset
  // endpoint, which inlines both. `asset` stays the source of the lifecycle
  // fields the list already refreshes.
  const detailQuery = useAsset(asset?.id ?? '');

  // A different asset starts with no panel open: `adding` is about the asset
  // in front of the member, and this component is kept mounted across
  // selections.
  useEffect(() => setAdding(null), [asset?.id]);

  if (!asset) return null;

  const totals = costsQuery.data?.data.totals;
  const links = costsQuery.data?.data.links ?? [];
  const transactions = transactionsQuery.data?.data ?? [];
  const lifecycle = lifecycleLine(asset, t, formatDate, formatMoney);
  const vehicle = detailQuery.data?.data.vehicle ?? null;
  const facility = detailQuery.data?.data.facility ?? null;
  // An asset carries AT MOST ONE detail row - the server answers 409
  // ASSET_DETAIL_CONFLICT for the second - so once either exists, the other's
  // action goes away. That is the server rule expressed as UI rather than as
  // an error a member has to read. Note what this does NOT consult:
  // `asset.category`. Category is free text and always was, so the detail
  // row's presence is the only signal of what kind of thing this is.
  const canAddDetail = !vehicle && !facility;

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
              {asset.placeId && <p>{t('ethel.places.place')}: {placePath(places, asset.placeId)}</p>}
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

            {(vehicle || adding === 'vehicle') && (
              <VehicleDetails assetId={asset.id} vehicle={vehicle} onRemoved={() => setAdding(null)} />
            )}
            {(facility || adding === 'facility') && (
              <FacilityDetails assetId={asset.id} facility={facility} places={places} onRemoved={() => setAdding(null)} />
            )}

            {/* Both actions, or neither. Opening one form also withdraws the
                other action: two open forms would let the member fill in both
                and meet the 409 on the second save, which is exactly the
                error this arrangement exists to prevent. */}
            {canAddDetail && adding === null && (
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setAdding('vehicle')}>
                  {t('ethel.vehicle.add')}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setAdding('facility')}>
                  {t('ethel.facility.add')}
                </Button>
              </div>
            )}

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

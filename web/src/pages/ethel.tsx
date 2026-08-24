import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { ErrorState } from '@/components/ui/error-state';
import { retryOf } from '@/lib/query-error';
import { cn } from '@/lib/utils';
import { ETHEL_PAGE_SIZE } from '@/lib/constants';
import { useFormatters } from '@/hooks/use-formatters';
import { useEthelAssets, useCreateAsset, usePlaces } from '@/hooks/use-ethel';
import AssetForm from '@/components/ethel/asset-form';
import AssetDetail from '@/components/ethel/asset-detail';
import PlacePicker from '@/components/ethel/place-picker';
import PlaceManager from '@/components/ethel/place-manager';
import { placePath } from '@/lib/place-tree';
import { lifecycleLine } from '@/components/ethel/lifecycle';
import type { EthelAsset } from '@/lib/types';

const STATUS_FILTERS = ['', 'active', 'decommissioned'] as const;

export default function EthelPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { formatDate, formatMoney } = useFormatters();
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>('');
  const [q, setQ] = useState('');
  const [placeId, setPlaceId] = useState<string | null>(null);
  const [includeDescendants, setIncludeDescendants] = useState(false);
  const [hasFacility, setHasFacility] = useState(false);
  // Set from the place manager's "systems serving this place" link. Unlike
  // placeId this is not "where the asset lives" but "what it serves", so the
  // two are independent filters and can be combined.
  const [servesPlaceId, setServesPlaceId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [placesOpen, setPlacesOpen] = useState(false);
  const [selected, setSelected] = useState<EthelAsset | null>(null);
  const [offset, setOffset] = useState(0);
  const [assets, setAssets] = useState<EthelAsset[]>([]);
  // Offsets already folded into `assets` — guards against re-appending the same
  // page when this query re-renders with unchanged data (we accumulate rather
  // than replace). Same idiom as LedgerView.
  const appendedOffsets = useRef<Set<number>>(new Set());
  const lastDataUpdatedAt = useRef(0);

  // `limit` stays at ETHEL_PAGE_SIZE (the server caps it at 100 and 400s
  // anything above); "load more" walks `offset` forward. Search and the status
  // filter are SERVER-side: a client-side filter would only ever search the
  // pages already loaded.
  const assetsQuery = useEthelAssets({
    status: status || undefined,
    q: q || undefined,
    placeId: placeId ?? undefined,
    // Sent only WITH a place: the server answers 400 VALIDATION_ERROR for
    // includeDescendants without placeId, and the toggle below is disabled in
    // that state so the combination cannot be constructed at all.
    includeDescendants: placeId && includeDescendants ? 'true' : undefined,
    // Only ever the string 'true' - an unset filter is omitted rather than
    // sent as 'false', so the query string carries no dead params.
    hasFacility: hasFacility ? 'true' : undefined,
    servesPlaceId: servesPlaceId ?? undefined,
    limit: ETHEL_PAGE_SIZE,
    offset,
  });
  const createAsset = useCreateAsset();
  const placesQuery = usePlaces();
  const places = placesQuery.data?.data ?? [];
  const retry = retryOf(assetsQuery);

  // A changed filter is a different result set: drop the accumulated pages and
  // restart at the top rather than paging into a list that no longer matches.
  useEffect(() => {
    setAssets([]);
    appendedOffsets.current = new Set();
    lastDataUpdatedAt.current = 0;
    setOffset(0);
  }, [status, q, placeId, includeDescendants, hasFacility, servesPlaceId]);

  useEffect(() => {
    const data = assetsQuery.data;
    if (!data) return;
    const pageOffset = data.meta.offset ?? 0;
    const updatedAt = assetsQuery.dataUpdatedAt;
    const isRefetch = updatedAt > lastDataUpdatedAt.current;

    if (appendedOffsets.current.has(pageOffset)) {
      if (!isRefetch) return; // Unchanged re-render of already-folded data.

      if (pageOffset === 0) {
        // Invalidation refetch of the page at the top (create / decommission /
        // delete all invalidate the ethel key): replace it in place.
        appendedOffsets.current = new Set([0]);
        setAssets(data.data);
        lastDataUpdatedAt.current = updatedAt;
        return;
      }

      // Invalidation landed on a LATER page, i.e. the user had loaded more when
      // a mutation hit. Patching mid-list would either drop earlier rows or
      // desync the offset math (a create can shift every row, since the list is
      // sorted by name), so restart at the top. Bookkeeping is updated BEFORE
      // setOffset so the page-0 fetch it triggers reads as a first-time load.
      appendedOffsets.current = new Set();
      lastDataUpdatedAt.current = updatedAt;
      setAssets([]);
      setOffset(0);
      return;
    }

    appendedOffsets.current.add(pageOffset);
    setAssets((prev) => (pageOffset === 0 ? data.data : [...prev, ...data.data]));
    lastDataUpdatedAt.current = updatedAt;
  }, [assetsQuery.data, assetsQuery.dataUpdatedAt]);

  if (retry) return <ErrorState message={t('common.loadFailed')} onRetry={retry} />;

  const meta = assetsQuery.data?.meta;

  // Prefer the freshly refetched row over the plain `selected` snapshot, so
  // the open detail view picks up server-side changes (e.g. decommission)
  // as soon as the list query refetches, instead of staying stale until the
  // dialog is closed and reopened.
  const displayedAsset = selected ? (assets.find((i) => i.id === selected.id) ?? selected) : null;

  const submitCreate = async (input: Parameters<typeof createAsset.mutateAsync>[0]) => {
    try {
      await createAsset.mutateAsync(input);
      setFormOpen(false);
    } catch (e) {
      toast((e as Error).message || t('ethel.title'), 'error');
    }
  };

  const filterLabel = (s: (typeof STATUS_FILTERS)[number]) => {
    if (s === 'active') return t('ethel.filterActive');
    if (s === 'decommissioned') return t('ethel.filterDecommissioned');
    return t('ethel.filterAll');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t('ethel.title')}</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setPlacesOpen(true)}>{t('ethel.places.manage')}</Button>
          <Button onClick={() => setFormOpen(true)}><Plus className="h-4 w-4 mr-1" /> {t('ethel.addAsset')}</Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <Input placeholder={t('ethel.search')} value={q} onChange={(e) => setQ(e.target.value)} className="w-56" />
        <div className="flex gap-1">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s || 'all'}
              type="button"
              onClick={() => setStatus(s)}
              className={cn(
                'px-3 py-1 rounded-full text-sm font-medium transition-colors',
                status === s ? 'bg-ember text-white' : 'bg-linen text-ink hover:bg-tan',
              )}
            >
              {filterLabel(s)}
            </button>
          ))}
        </div>
        <div className="w-56">
          <PlacePicker
            id="ethel-filter-place"
            places={places}
            value={placeId}
            onChange={(id) => {
              setPlaceId(id);
              // Clearing the place clears the toggle too, so the next
              // selection does not silently inherit a stale "include
              // contents" from a place the member has left.
              if (!id) setIncludeDescendants(false);
            }}
            label={t('ethel.places.place')}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeDescendants}
            // Disabled without a place: the server 400s
            // includeDescendants-without-placeId, so the UI must not be able
            // to send it.
            disabled={!placeId}
            onChange={(e) => setIncludeDescendants(e.target.checked)}
          />
          {t('ethel.places.includeContents')}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={hasFacility}
            onChange={(e) => setHasFacility(e.target.checked)}
          />
          {t('ethel.filterFacilities')}
        </label>
        {servesPlaceId && (
          // Clicking it clears the filter: the chip is both the statement that
          // the filter is on and the way out of it, so a member who followed
          // the link from the place manager is not stranded in a filtered list.
          <button
            type="button"
            onClick={() => setServesPlaceId(null)}
            className="rounded-full bg-ember px-3 py-1 text-sm font-medium text-white"
          >
            {t('ethel.places.servingThis')}: {placePath(places, servesPlaceId)} ×
          </button>
        )}
      </div>

      {assets.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center">{t('ethel.empty')}</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {assets.map((asset) => (
            <Card key={asset.id} className="cursor-pointer" onClick={() => setSelected(asset)}>
              <CardContent className="p-4 space-y-1">
                <p className="font-medium">{asset.name}</p>
                <p className="text-xs text-muted-foreground">
                  {[asset.category, asset.placeId ? placePath(places, asset.placeId) : null].filter(Boolean).join(' · ') || '—'}
                </p>
                {(() => {
                  const line = lifecycleLine(asset, t, formatDate, formatMoney);
                  return line ? <p className="text-xs text-muted-foreground">{line}</p> : null;
                })()}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {meta && meta.total > assets.length && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={() => setOffset((o) => o + ETHEL_PAGE_SIZE)}>
            {t('ethel.loadMore')}
          </Button>
        </div>
      )}

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('ethel.addAsset')}</DialogTitle>
            <DialogClose onClose={() => setFormOpen(false)} />
          </DialogHeader>
          <AssetForm places={places} onSubmit={submitCreate} onCancel={() => setFormOpen(false)} isLoading={createAsset.isPending} />
        </DialogContent>
      </Dialog>

      <AssetDetail asset={displayedAsset} places={places} onClose={() => setSelected(null)} />

      <PlaceManager
        open={placesOpen}
        onClose={() => setPlacesOpen(false)}
        onShowServing={(id) => {
          setServesPlaceId(id);
          setPlacesOpen(false);
        }}
      />
    </div>
  );
}

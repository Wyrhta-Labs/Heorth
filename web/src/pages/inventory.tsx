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
import { INVENTORY_PAGE_SIZE } from '@/lib/constants';
import { useFormatters } from '@/hooks/use-formatters';
import { useInventoryItems, useCreateItem } from '@/hooks/use-inventory';
import ItemForm from '@/components/inventory/item-form';
import ItemDetail from '@/components/inventory/item-detail';
import { lifecycleLine } from '@/components/inventory/lifecycle';
import type { InventoryItem } from '@/lib/types';

const STATUS_FILTERS = ['', 'active', 'decommissioned'] as const;

export default function InventoryPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { formatDate, formatMoney } = useFormatters();
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>('');
  const [q, setQ] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [selected, setSelected] = useState<InventoryItem | null>(null);
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<InventoryItem[]>([]);
  // Offsets already folded into `items` — guards against re-appending the same
  // page when this query re-renders with unchanged data (we accumulate rather
  // than replace). Same idiom as LedgerView.
  const appendedOffsets = useRef<Set<number>>(new Set());
  const lastDataUpdatedAt = useRef(0);

  // `limit` stays at INVENTORY_PAGE_SIZE (the server caps it at 100 and 400s
  // anything above); "load more" walks `offset` forward. Search and the status
  // filter are SERVER-side: a client-side filter would only ever search the
  // pages already loaded.
  const itemsQuery = useInventoryItems({
    status: status || undefined,
    q: q || undefined,
    limit: INVENTORY_PAGE_SIZE,
    offset,
  });
  const createItem = useCreateItem();
  const retry = retryOf(itemsQuery);

  // A changed filter is a different result set: drop the accumulated pages and
  // restart at the top rather than paging into a list that no longer matches.
  useEffect(() => {
    setItems([]);
    appendedOffsets.current = new Set();
    lastDataUpdatedAt.current = 0;
    setOffset(0);
  }, [status, q]);

  useEffect(() => {
    const data = itemsQuery.data;
    if (!data) return;
    const pageOffset = data.meta.offset ?? 0;
    const updatedAt = itemsQuery.dataUpdatedAt;
    const isRefetch = updatedAt > lastDataUpdatedAt.current;

    if (appendedOffsets.current.has(pageOffset)) {
      if (!isRefetch) return; // Unchanged re-render of already-folded data.

      if (pageOffset === 0) {
        // Invalidation refetch of the page at the top (create / decommission /
        // delete all invalidate the inventory key): replace it in place.
        appendedOffsets.current = new Set([0]);
        setItems(data.data);
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
      setItems([]);
      setOffset(0);
      return;
    }

    appendedOffsets.current.add(pageOffset);
    setItems((prev) => (pageOffset === 0 ? data.data : [...prev, ...data.data]));
    lastDataUpdatedAt.current = updatedAt;
  }, [itemsQuery.data, itemsQuery.dataUpdatedAt]);

  if (retry) return <ErrorState message={t('common.loadFailed')} onRetry={retry} />;

  const meta = itemsQuery.data?.meta;

  // Prefer the freshly refetched row over the plain `selected` snapshot, so
  // the open detail view picks up server-side changes (e.g. decommission)
  // as soon as the list query refetches, instead of staying stale until the
  // dialog is closed and reopened.
  const displayedItem = selected ? (items.find((i) => i.id === selected.id) ?? selected) : null;

  const submitCreate = async (input: Parameters<typeof createItem.mutateAsync>[0]) => {
    try {
      await createItem.mutateAsync(input);
      setFormOpen(false);
    } catch (e) {
      toast((e as Error).message || t('inventory.title'), 'error');
    }
  };

  const filterLabel = (s: (typeof STATUS_FILTERS)[number]) => {
    if (s === 'active') return t('inventory.filterActive');
    if (s === 'decommissioned') return t('inventory.filterDecommissioned');
    return t('inventory.filterAll');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t('inventory.title')}</h1>
        <Button onClick={() => setFormOpen(true)}><Plus className="h-4 w-4 mr-1" /> {t('inventory.addItem')}</Button>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <Input placeholder={t('inventory.search')} value={q} onChange={(e) => setQ(e.target.value)} className="w-56" />
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
      </div>

      {items.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center">{t('inventory.empty')}</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.map((item) => (
            <Card key={item.id} className="cursor-pointer" onClick={() => setSelected(item)}>
              <CardContent className="p-4 space-y-1">
                <p className="font-medium">{item.name}</p>
                <p className="text-xs text-muted-foreground">
                  {[item.category, item.location].filter(Boolean).join(' · ') || '—'}
                </p>
                {(() => {
                  const line = lifecycleLine(item, t, formatDate, formatMoney);
                  return line ? <p className="text-xs text-muted-foreground">{line}</p> : null;
                })()}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {meta && meta.total > items.length && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={() => setOffset((o) => o + INVENTORY_PAGE_SIZE)}>
            {t('inventory.loadMore')}
          </Button>
        </div>
      )}

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('inventory.addItem')}</DialogTitle>
            <DialogClose onClose={() => setFormOpen(false)} />
          </DialogHeader>
          <ItemForm onSubmit={submitCreate} onCancel={() => setFormOpen(false)} isLoading={createItem.isPending} />
        </DialogContent>
      </Dialog>

      <ItemDetail item={displayedItem} onClose={() => setSelected(null)} />
    </div>
  );
}

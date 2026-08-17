import { useState } from 'react';
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

  const itemsQuery = useInventoryItems({ status: status || undefined, limit: 200 });
  const createItem = useCreateItem();
  const retry = retryOf(itemsQuery);

  if (retry) return <ErrorState message={t('common.loadFailed')} onRetry={retry} />;

  const allItems = itemsQuery.data?.data ?? [];
  const items = q ? allItems.filter((i) => i.name.toLowerCase().includes(q.toLowerCase())) : allItems;

  // Prefer the freshly refetched row over the plain `selected` snapshot, so
  // the open detail view picks up server-side changes (e.g. decommission)
  // as soon as the list query refetches, instead of staying stale until the
  // dialog is closed and reopened.
  const displayedItem = selected ? (allItems.find((i) => i.id === selected.id) ?? selected) : null;

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

import { startOfWeek, endOfWeek, format } from 'date-fns';
import ShoppingList from '@/components/meals/shopping-list';
import OfflineBanner from '@/components/pwa/offline-banner';
import { useOfflineShoppingList } from '@/hooks/use-offline-shopping-list';

/**
 * Phone-first shopping list: one-handed, big check-offs, and — the killer
 * mobile moment — safe to use with a dead spot in the supermarket. Offline
 * behaviour lives in useOfflineShoppingList/src/lib/shopping-offline.ts.
 */
export default function ShoppingPage() {
  const from = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');
  const to = format(endOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');
  const { items, isOffline, dataAsOf, pendingCount, toggle, add, remove, generate } = useOfflineShoppingList();

  return (
    <div className="space-y-4 max-w-md mx-auto">
      <h3 className="font-serif text-2xl text-ink">Shopping list</h3>
      <OfflineBanner isOffline={isOffline} dataAsOf={dataAsOf} pendingCount={pendingCount} />
      <ShoppingList
        items={items}
        onToggle={toggle}
        onAdd={add}
        onRemove={remove}
        onGenerate={() => generate(from, to)}
      />
    </div>
  );
}

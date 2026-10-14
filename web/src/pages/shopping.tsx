import { useTranslation } from 'react-i18next';
import ShoppingList from '@/components/meals/shopping-list';
import OfflineBanner from '@/components/pwa/offline-banner';
import { useOfflineShoppingList } from '@/hooks/use-offline-shopping-list';
import { useHouseholdZone, useHouseholdToday } from '@/hooks/use-household-zone';
import { weekOfIso } from '@/lib/format';

/**
 * Phone-first shopping list: one-handed, big check-offs, and — the killer
 * mobile moment — safe to use with a dead spot in the supermarket. Offline
 * behaviour lives in useOfflineShoppingList/src/lib/shopping-offline.ts.
 */
export default function ShoppingPage() {
  const { t } = useTranslation();
  // Generation covers the HOUSEHOLD's week; offline, /household fails and
  // the browser's week stands in.
  const { zone, ready } = useHouseholdZone();
  const week = weekOfIso(useHouseholdToday(zone));
  const { items, isOffline, dataAsOf, pendingCount, toggle, add, remove, generate } = useOfflineShoppingList();

  return (
    <div className="space-y-4 max-w-md mx-auto">
      <h3 className="font-serif text-2xl text-ink">{t('shopping.title')}</h3>
      <OfflineBanner isOffline={isOffline} dataAsOf={dataAsOf} pendingCount={pendingCount} />
      <ShoppingList
        items={items}
        onToggle={toggle}
        onAdd={add}
        onRemove={remove}
        onGenerate={() => generate(week[0]!, week[6]!)}
        generateDisabled={!ready}
      />
    </div>
  );
}

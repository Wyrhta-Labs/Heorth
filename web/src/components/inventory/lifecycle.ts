import type { TFunction } from 'i18next';
import type { InventoryItem } from '@/lib/types';

/**
 * The single lifecycle line shown on an item's card and detail view:
 * decommissioned takes priority (it's the terminal state), then purchase info,
 * then a bare warranty note, else nothing.
 */
export function lifecycleLine(
  item: InventoryItem,
  t: TFunction,
  formatDate: (d: string | null | undefined) => string,
  formatMoney: (v: string | number | null | undefined) => string,
): string | null {
  if (item.decommissionedAt) {
    return t('inventory.lifecycle.decommissioned', {
      date: formatDate(item.decommissionedAt),
      reason: item.decommissionReason ? t(`inventory.reasons.${item.decommissionReason}`) : '—',
    });
  }
  if (item.purchaseDate) {
    return t('inventory.lifecycle.purchased', { date: formatDate(item.purchaseDate), price: formatMoney(item.purchasePrice) });
  }
  if (item.warrantyUntil) {
    return t('inventory.lifecycle.warranty', { date: formatDate(item.warrantyUntil) });
  }
  return null;
}

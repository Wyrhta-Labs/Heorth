import type { TFunction } from 'i18next';
import type { EthelAsset } from '@/lib/types';

/**
 * The single lifecycle line shown on an asset's card and detail view:
 * decommissioned takes priority (it's the terminal state), then purchase info,
 * then a bare warranty note, else nothing.
 */
export function lifecycleLine(
  asset: EthelAsset,
  t: TFunction,
  formatDate: (d: string | null | undefined) => string,
  formatMoney: (v: string | number | null | undefined) => string,
): string | null {
  if (asset.decommissionedAt) {
    return t('ethel.lifecycle.decommissioned', {
      date: formatDate(asset.decommissionedAt),
      reason: asset.decommissionReason ? t(`ethel.reasons.${asset.decommissionReason}`) : '—',
    });
  }
  if (asset.purchaseDate) {
    return t('ethel.lifecycle.purchased', { date: formatDate(asset.purchaseDate), price: formatMoney(asset.purchasePrice) });
  }
  if (asset.warrantyUntil) {
    return t('ethel.lifecycle.warranty', { date: formatDate(asset.warrantyUntil) });
  }
  return null;
}

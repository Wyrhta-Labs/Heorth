const DAY_MS = 86_400_000;
/** A key nobody has used for this long is probably forgotten. */
export const STALE_UNUSED_DAYS = 90;
/** A minted key that never got used at all is flagged sooner. */
export const STALE_NEVER_USED_DAYS = 30;

/**
 * Whether the admin key overview should badge a key as stale. Presentation
 * only — nothing expires; it just points the admin at keys worth revoking.
 */
export function isStaleKey(key: { createdAt: string; lastUsedAt: string | null }, now: Date = new Date()): boolean {
  const ageDays = (iso: string) => (now.getTime() - new Date(iso).getTime()) / DAY_MS;
  return key.lastUsedAt
    ? ageDays(key.lastUsedAt) > STALE_UNUSED_DAYS
    : ageDays(key.createdAt) > STALE_NEVER_USED_DAYS;
}

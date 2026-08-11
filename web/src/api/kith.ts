import { apiGet, qs } from './client';
import type { KithReminder } from '@/lib/types';

// The kith proxy's list envelope carries an empty meta object (no total /
// paging — the upstream window query returns everything in range).
export interface KithRemindersResponse { data: KithReminder[]; meta: Record<string, never>; }

/** Both bounds are required full ISO instants (`z.string().datetime()` server-side). */
export interface ListKithRemindersParams { from: string; to: string; }

export function listKithReminders(params: ListKithRemindersParams): Promise<KithRemindersResponse> {
  return apiGet(`/kith/reminders${qs(params as unknown as Record<string, unknown>)}`);
}

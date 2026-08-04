import { apiGet, apiPost, apiDelete } from './client';
import type { SingleResponse } from '@/lib/types';
import type { FeedStatus } from '@/lib/hearth';

/** A member's Microsoft 365 connection, as surfaced by `GET /m365/status`. */
export interface M365Connection {
  memberId: string;
  accountUpn: string;
  status: string;
  lastRefreshSuccessAt: string | null;
  lastRefreshError: string | null;
}

/**
 * GET /api/v1/m365/status — the health surface (Task 2.2/2.3). Returns per-feed
 * sync state used for the Hearth View staleness badges. The member view returns
 * their own feeds; admin sees all. `feeds` is the only field the wall reads.
 * When the M365 integration is disabled the route 404s — callers treat that as
 * "no feeds" (no staleness to show), not an error worth surfacing on the wall.
 */
export interface M365Status {
  feeds: FeedStatus[];
  connection?: M365Connection | null;
  connections?: M365Connection[];
}

export function getM365Status(): Promise<SingleResponse<M365Status>> {
  return apiGet('/m365/status');
}

/** The consent URL, fetched as JSON because a browser navigation cannot carry the Bearer token. */
export function getM365ConnectUrl(): Promise<SingleResponse<{ url: string }>> {
  return apiGet('/m365/connect-url');
}

export function disconnectM365(): Promise<SingleResponse<{ disconnected: boolean }>> {
  return apiDelete('/m365/connection');
}

/** A single feed's outcome from a manual sync trigger. */
export interface M365SyncResult {
  feedKey: string;
  status: 'ok' | 'skipped' | 'error';
  reason?: string;
}

/**
 * POST /api/v1/m365/sync — admin-only manual sync trigger. Runs all calendar
 * feeds then all To Do feeds once and returns the combined per-feed result
 * summary (used by the admin connections overview's "Sync now" button).
 */
export function triggerM365Sync(): Promise<SingleResponse<{ results: M365SyncResult[] }>> {
  return apiPost('/m365/sync', {});
}

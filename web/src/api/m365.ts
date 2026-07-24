import { apiGet } from './client';
import type { SingleResponse } from '@/lib/types';
import type { FeedStatus } from '@/lib/hearth';

/**
 * GET /api/v1/m365/status — the health surface (Task 2.2/2.3). Returns per-feed
 * sync state used for the Hearth View staleness badges. The member view returns
 * their own feeds; admin sees all. `feeds` is the only field the wall reads.
 * When the M365 integration is disabled the route 404s — callers treat that as
 * "no feeds" (no staleness to show), not an error worth surfacing on the wall.
 */
export interface M365Status {
  feeds: FeedStatus[];
  connection?: unknown;
  connections?: unknown;
}

export function getM365Status(): Promise<SingleResponse<M365Status>> {
  return apiGet('/m365/status');
}

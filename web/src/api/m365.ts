import { apiGet, apiPost, apiDelete } from './client';
import type { SingleResponse } from '@/lib/types';
import type { FeedStatus } from '@/lib/hearth';

/** One member's connection to ONE provider, as `/integrations/status` returns it. */
export interface IntegrationConnection {
  provider: string;
  memberId: string;
  accountLabel: string;
  status: string;
  lastRefreshSuccessAt: string | null;
  lastRefreshError: string | null;
}

/** Health of the designated household (family) calendar, or null when none. */
export interface HouseholdCalendarStatus {
  provider: string;
  memberId: string;
  calendarName: string | null;
  /** False when the designating member's connection is missing or dead — the
   *  family feed is then silently stopped until an adult designates another. */
  connectionOk: boolean;
}

/**
 * GET /api/v1/integrations/status — the provider-neutral health surface. Always
 * 200: with no provider registered it reports empty lists, which is the honest
 * answer rather than an error worth surfacing on the wall.
 */
export interface IntegrationsStatus {
  /** The acting member's own connections, one per provider they have linked. */
  myConnections: IntegrationConnection[];
  /** Household-wide, admin/adult only. */
  connections?: IntegrationConnection[];
  feeds: FeedStatus[];
  householdListDesignated: boolean;
  householdCalendar: HouseholdCalendarStatus | null;
  providers: string[];
}

export function getIntegrationsStatus(): Promise<SingleResponse<IntegrationsStatus>> {
  return apiGet('/integrations/status');
}

/** The consent URL, fetched as JSON because a navigation cannot carry the Bearer token. */
export function getConnectUrl(provider: string): Promise<SingleResponse<{ url: string }>> {
  return apiGet(`/integrations/${provider}/connect-url`);
}

export function disconnectProvider(provider: string): Promise<SingleResponse<{ disconnected: boolean }>> {
  return apiDelete(`/integrations/${provider}/connection`);
}

/** A single feed's outcome from a manual sync trigger. */
export interface M365SyncResult {
  feedKey: string;
  status: 'ok' | 'skipped' | 'error';
  reason?: string;
}

/**
 * POST /api/v1/integrations/sync — admin-only manual sync trigger. Runs all calendar
 * feeds then all To Do feeds once and returns the combined per-feed result
 * summary (used by the admin connections overview's "Sync now" button).
 */
export function triggerIntegrationsSync(): Promise<SingleResponse<{ results: M365SyncResult[] }>> {
  return apiPost('/integrations/sync', {});
}

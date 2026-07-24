import { getM365Runtime, type M365Runtime } from './runtime.js';
import { GraphError } from './graph.js';
import { GraphCalendarProvider } from './calendar-provider.js';
import type { CalendarFeed, CalendarProvider } from '../modules/calendar/providers/types.js';
import { applyMirrorPull } from '../modules/calendar/mirror-store.js';

/**
 * Calendar sync runner. Pulls each feed's delta through the (provider-agnostic)
 * {@link CalendarProvider}, applies it to the read-only mirror, and records
 * per-feed state in `m365_sync_state`. Per-feed errors are isolated and recorded
 * (short, classified messages only — never verbose upstream bodies) so one bad
 * feed can neither stop the others nor crash the caller.
 */

export interface FeedSyncResult {
  feedKey: string;
  status: 'ok' | 'skipped' | 'error';
  upserted?: number;
  deleted?: number;
  /** Short classified reason when status is 'skipped' or 'error'. */
  reason?: string;
}

/**
 * How often a feed must do a full (freshly-windowed) re-sync even when its
 * delta token is still valid. Without this, `calendarView/delta` replays the
 * SAME startDateTime/endDateTime the token was minted with forever — the past
 * horizon never trims and the future horizon shrinks in real terms until an
 * unpredictable Graph 410 forces a re-window. Deterministic re-windowing on a
 * schedule, rather than relying on the 410, is what makes the window actually
 * roll. Independent of the all-or-nothing `M365_*` credential group (a tuning
 * knob, not a credential) — deliberately NOT reusing `M365_SYNC_INTERVAL_SECONDS`
 * (that's the tick cadence; this is the re-window cadence).
 */
const DEFAULT_FULL_RESYNC_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function fullResyncIntervalMs(): number {
  const raw = process.env['M365_FULL_RESYNC_INTERVAL_SECONDS'];
  if (!raw) return DEFAULT_FULL_RESYNC_INTERVAL_MS;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0
    ? seconds * 1000
    : DEFAULT_FULL_RESYNC_INTERVAL_MS;
}

/** Whether a feed is due for a deterministic periodic re-window. */
function isFullResyncDue(lastFullSyncAt: Date | null, now: Date): boolean {
  if (!lastFullSyncAt) return true; // never done a full sync → due
  return now.getTime() - lastFullSyncAt.getTime() >= fullResyncIntervalMs();
}

/**
 * Classify a failure into a SHORT, safe token for `m365_sync_state.lastError`.
 * Never returns an upstream response body or token material.
 */
function classify(e: unknown): string {
  if (e instanceof GraphError) {
    if (e.code === 'needs_reauth' || e.status === 401) return 'needs_reauth';
    if (e.code === 'no_connection') return 'no_connection';
    return `graph_${e.status}`;
  }
  if (e instanceof Error && e.name === 'ReadOnlyEventError') return 'error';
  if (e instanceof TypeError) return 'network_error';
  return 'error';
}

/** Sync one feed. Isolated: never throws — always returns a result. */
async function syncFeed(
  provider: CalendarProvider,
  feed: CalendarFeed,
  rt: M365Runtime,
): Promise<FeedSyncResult> {
  // A member whose delegated connection needs re-consent: record the stale state
  // but do NOT attempt a token refresh every tick (no hot retry against Graph).
  if (feed.kind === 'member' && feed.memberId) {
    const conn = await rt.store.getConnection(feed.memberId);
    if (!conn) {
      return { feedKey: feed.feedKey, status: 'skipped', reason: 'no_connection' };
    }
    if (conn.status === 'needs_reauth') {
      await rt.store.recordSyncFailure(feed.feedKey, 'needs_reauth');
      return { feedKey: feed.feedKey, status: 'skipped', reason: 'needs_reauth' };
    }
  }

  try {
    const state = await rt.store.getSyncState(feed.feedKey);
    const forceFullResync = isFullResyncDue(state?.lastFullSyncAt ?? null, new Date());
    const result = await provider.pullChanges(feed.feedKey, state?.deltaToken ?? null, forceFullResync);
    const { upserted, deleted } = await applyMirrorPull(provider.source, feed.feedKey, result);
    await rt.store.recordSyncSuccess(feed.feedKey, result.nextToken, result.fullResync);
    return { feedKey: feed.feedKey, status: 'ok', upserted, deleted };
  } catch (e) {
    const reason = classify(e);
    await rt.store.recordSyncFailure(feed.feedKey, reason);
    return { feedKey: feed.feedKey, status: 'error', reason };
  }
}

/**
 * Run all calendar feeds sequentially. Returns a per-feed result summary. Safe
 * to call from the scheduler tick or the manual `POST /api/v1/m365/sync` route.
 * Never rejects for a per-feed failure; only a total inability to enumerate
 * feeds (e.g. app-only token failure surfaced by listFeeds) would propagate.
 */
export async function runCalendarSync(
  rt: M365Runtime = getM365Runtime(),
  provider: CalendarProvider = new GraphCalendarProvider(rt),
): Promise<FeedSyncResult[]> {
  const feeds = await provider.listFeeds();
  const results: FeedSyncResult[] = [];
  for (const feed of feeds) {
    results.push(await syncFeed(provider, feed, rt));
  }
  return results;
}

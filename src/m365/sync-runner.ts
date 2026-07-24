import type { M365Runtime } from './runtime.js';
import { GraphError } from './graph.js';

/**
 * Provider-agnostic per-feed sync machinery, shared by the calendar mirror
 * (`calendar-sync.ts`) and the To Do mirror (`task-sync.ts`). Extracted from the
 * original calendar sync runner (Task 2.2) so both surfaces get identical
 * behaviour — connection short-circuiting, deterministic periodic re-window,
 * error classification, and per-feed isolation — without duplication.
 *
 * A concrete runner enumerates its feeds, then for each calls {@link syncOneFeed}
 * with a `pullAndApply` closure that does the provider pull + mirror write. This
 * module owns everything AROUND that closure: the needs_reauth / no_connection
 * short-circuit, reading/advancing sync state, deciding when a full re-window is
 * due, recording success/failure, and never throwing for a per-feed error.
 */

export interface FeedSyncResult {
  feedKey: string;
  status: 'ok' | 'skipped' | 'error';
  upserted?: number;
  deleted?: number;
  /** Short classified reason when status is 'skipped' or 'error'. */
  reason?: string;
}

/** The minimum a runner must tell {@link syncOneFeed} about a feed. */
export interface RunnableFeed {
  feedKey: string;
  /**
   * Member whose delegated connection backs this feed, or null for an app-only
   * feed (the family mailbox). Used ONLY for the connection health short-circuit.
   */
  memberId: string | null;
}

/** What a `pullAndApply` closure reports back after writing the mirror. */
export interface FeedPullOutcome {
  nextToken: string | null;
  fullResync: boolean;
  upserted: number;
  deleted: number;
}

/**
 * How often a feed must do a full (freshly-windowed / full-snapshot) re-sync even
 * when its delta token is still valid. For the calendar this re-anchors the
 * rolling `calendarView` window; for To Do it re-pulls the whole list so drift
 * from missed deltas self-heals. Without it, a delta token replays its frozen
 * scope forever until an unpredictable Graph 410. Deterministic re-windowing on a
 * schedule is what keeps the mirror honest. Independent of the all-or-nothing
 * `M365_*` credential group (a tuning knob, not a credential) and of
 * `M365_SYNC_INTERVAL_SECONDS` (the tick cadence, not the re-window cadence).
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

/** Whether a feed is due for a deterministic periodic re-window / full re-sync. */
export function isFullResyncDue(lastFullSyncAt: Date | null, now: Date): boolean {
  if (!lastFullSyncAt) return true; // never done a full sync → due
  return now.getTime() - lastFullSyncAt.getTime() >= fullResyncIntervalMs();
}

/**
 * Classify a failure into a SHORT, safe token for `m365_sync_state.lastError`.
 * Never returns an upstream response body or token material.
 */
export function classify(e: unknown): string {
  if (e instanceof GraphError) {
    // Check no_connection first: that error also carries status 401, so the
    // needs_reauth (status 401) branch would otherwise swallow it. On the sync
    // path this never matters (a missing connection short-circuits before any
    // Graph call), but a write-back reaches classify directly.
    if (e.code === 'no_connection') return 'no_connection';
    if (e.code === 'needs_reauth' || e.status === 401) return 'needs_reauth';
    return `graph_${e.status}`;
  }
  if (e instanceof TypeError) return 'network_error';
  return 'error';
}

/**
 * Sync one feed. Isolated: never throws — always returns a result.
 *
 *  1. For a member-backed feed, short-circuit on connection state: a missing
 *     connection is skipped silently; a `needs_reauth` connection is recorded as
 *     a failure but NOT hot-retried against Graph (no token refresh attempt).
 *  2. Otherwise read sync state, decide whether a periodic re-window is due, run
 *     the caller's `pullAndApply`, and record success — stamping `lastFullSyncAt`
 *     only when this pull was a full (windowed / full-snapshot) sync.
 *  3. Any error is classified to a short token and recorded as a failure.
 */
export async function syncOneFeed(
  rt: M365Runtime,
  feed: RunnableFeed,
  pullAndApply: (syncToken: string | null, forceFullResync: boolean) => Promise<FeedPullOutcome>,
): Promise<FeedSyncResult> {
  if (feed.memberId) {
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
    const outcome = await pullAndApply(state?.deltaToken ?? null, forceFullResync);
    await rt.store.recordSyncSuccess(feed.feedKey, outcome.nextToken, outcome.fullResync);
    return {
      feedKey: feed.feedKey, status: 'ok',
      upserted: outcome.upserted, deleted: outcome.deleted,
    };
  } catch (e) {
    const reason = classify(e);
    await rt.store.recordSyncFailure(feed.feedKey, reason);
    return { feedKey: feed.feedKey, status: 'error', reason };
  }
}

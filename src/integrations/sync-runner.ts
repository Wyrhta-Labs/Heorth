import type { IntegrationStore } from './store.js';

/**
 * Provider-agnostic per-feed sync machinery, shared by every provider and both
 * surfaces (calendar mirror + task mirror).
 *
 * A concrete runner enumerates its feeds, then for each calls {@link syncOneFeed}
 * with a `pullAndApply` closure that does the provider pull + mirror write. This
 * module owns everything AROUND that closure: the needs_reauth / no_connection
 * short-circuit, reading and advancing sync state, deciding when a full re-window
 * is due, recording success/failure, and never throwing for a per-feed error.
 *
 * It knows nothing about any upstream API. Error classification arrives through
 * {@link SyncDeps.classifyError} — previously this module did
 * `e instanceof GraphError`, which made "provider-agnostic" untrue.
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
   * Member whose delegated connection backs this feed, or null for a feed that
   * needs no per-member connection (the M365 app-only family mailbox). Used
   * ONLY for the connection health short-circuit.
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
 * How often a feed must do a full (freshly-windowed / whole-feed) re-sync even
 * when its sync token is still valid. For a calendar this re-anchors the rolling
 * window; for tasks it re-pulls the whole list so drift from missed deltas
 * self-heals. Without it, a token replays its frozen scope forever until an
 * unpredictable upstream token-invalidation.
 *
 * Provider-supplied, because providers differ: a delta-capable provider wants
 * this rare, while a provider with no delta API (Google Tasks) pulls a full
 * snapshot every tick and effectively ignores it.
 */
export const DEFAULT_FULL_RESYNC_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface SyncDeps {
  store: IntegrationStore;
  /**
   * Map a thrown value to a SHORT, safe token for `integration_sync_state.lastError`.
   * MUST NOT return an upstream response body or any token material.
   */
  classifyError: (e: unknown) => string;
  fullResyncIntervalMs: number;
}

/** Whether a feed is due for a deterministic periodic re-window / full re-sync. */
export function isFullResyncDue(
  lastFullSyncAt: Date | null, now: Date, intervalMs: number,
): boolean {
  if (!lastFullSyncAt) return true; // never done a full sync → due
  return now.getTime() - lastFullSyncAt.getTime() >= intervalMs;
}

/**
 * Sync one feed. Isolated: never throws — always returns a result.
 *
 *  1. For a member-backed feed, short-circuit on connection state: a missing
 *     connection is skipped silently; a `needs_reauth` connection is recorded as
 *     a failure but NOT hot-retried upstream (no token refresh attempt).
 *  2. Otherwise read sync state, decide whether a periodic re-window is due, run
 *     the caller's `pullAndApply`, and record success — stamping `lastFullSyncAt`
 *     only when this pull was a full sync.
 *  3. Any error is classified to a short token and recorded as a failure.
 */
export async function syncOneFeed(
  deps: SyncDeps,
  feed: RunnableFeed,
  pullAndApply: (syncToken: string | null, forceFullResync: boolean) => Promise<FeedPullOutcome>,
): Promise<FeedSyncResult> {
  if (feed.memberId) {
    const conn = await deps.store.getConnection(feed.memberId);
    if (!conn) {
      return { feedKey: feed.feedKey, status: 'skipped', reason: 'no_connection' };
    }
    if (conn.status === 'needs_reauth') {
      await deps.store.recordSyncFailure(feed.feedKey, 'needs_reauth');
      return { feedKey: feed.feedKey, status: 'skipped', reason: 'needs_reauth' };
    }
  }

  try {
    const state = await deps.store.getSyncState(feed.feedKey);
    const forceFullResync = isFullResyncDue(
      state?.lastFullSyncAt ?? null, new Date(), deps.fullResyncIntervalMs,
    );
    const outcome = await pullAndApply(state?.syncToken ?? null, forceFullResync);
    await deps.store.recordSyncSuccess(feed.feedKey, outcome.nextToken, outcome.fullResync);
    return {
      feedKey: feed.feedKey, status: 'ok',
      upserted: outcome.upserted, deleted: outcome.deleted,
    };
  } catch (e) {
    const reason = deps.classifyError(e);
    await deps.store.recordSyncFailure(feed.feedKey, reason);
    return { feedKey: feed.feedKey, status: 'error', reason };
  }
}

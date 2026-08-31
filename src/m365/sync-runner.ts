import { GraphError } from './graph.js';
import { DEFAULT_FULL_RESYNC_INTERVAL_MS } from '../integrations/sync-runner.js';

/**
 * Classify a Graph failure into a SHORT, safe token for
 * `integration_sync_state.lastError`. Never returns an upstream response body or
 * token material. Passed to the generic runner as `classifyError` — the runner
 * itself has no Graph knowledge.
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

/** M365's re-window cadence. Overridable for ops tuning; not a credential. */
export function m365FullResyncIntervalMs(): number {
  const raw = process.env['M365_FULL_RESYNC_INTERVAL_SECONDS'];
  if (!raw) return DEFAULT_FULL_RESYNC_INTERVAL_MS;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0
    ? seconds * 1000
    : DEFAULT_FULL_RESYNC_INTERVAL_MS;
}

// TEMPORARY SHIM — re-exported so calendar-sync.ts / task-sync.ts compile until
// they are rewired onto the integrations layer.
export {
  syncOneFeed, isFullResyncDue,
  type FeedSyncResult, type RunnableFeed, type FeedPullOutcome,
} from '../integrations/sync-runner.js';

import { GoogleApiError } from './api.js';
import { DEFAULT_FULL_RESYNC_INTERVAL_MS } from '../integrations/sync-runner.js';

/**
 * Classify a Google failure into a SHORT, safe token for
 * `integration_sync_state.lastError`. Never returns an upstream response body or
 * token material. Passed to the generic runner as `classifyError` — the runner
 * itself has no Google knowledge.
 *
 * The sibling of `src/m365/sync-runner.ts`'s `classify`, and like it this file
 * RUNS nothing despite the name: the runner is `src/integrations/sync-runner.ts`.
 */
export function classify(e: unknown): string {
  if (e instanceof GoogleApiError) {
    // no_connection first: it also carries 401, so the needs_reauth branch
    // would otherwise swallow it. Matters on the write-back path, which reaches
    // classify directly rather than short-circuiting in the sync runner.
    if (e.reason === 'no_connection') return 'no_connection';
    if (e.reason === 'needs_reauth' || e.status === 401) return 'needs_reauth';
    return `google_${e.status}`;
  }
  if (e instanceof TypeError) return 'network_error';
  return 'error';
}

/**
 * Google's re-window cadence. Overridable for ops tuning; not a credential, so
 * it lives outside the GOOGLE_* group exactly like M365's own knob.
 *
 * It governs the CALENDAR feeds only in practice: `GoogleTaskProvider` pulls a
 * complete snapshot on every tick, so a periodic forced full re-sync is already
 * what it always does.
 */
export function googleFullResyncIntervalMs(): number {
  const raw = process.env['GOOGLE_FULL_RESYNC_INTERVAL_SECONDS'];
  if (!raw) return DEFAULT_FULL_RESYNC_INTERVAL_MS;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0
    ? seconds * 1000
    : DEFAULT_FULL_RESYNC_INTERVAL_MS;
}

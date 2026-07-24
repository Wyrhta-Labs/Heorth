import { config } from '../config/env.js';
import { logError } from '@wyrhta/core/lib';
import { isM365Enabled } from './runtime.js';
import { runCalendarSync } from './calendar-sync.js';
import { runTaskSync } from './task-sync.js';

/**
 * Background poll loop for the M365 read-only mirror. Started at boot ONLY when
 * the integration is enabled (inherits the all-or-nothing gate) and NEVER in
 * tests — it is started from `main()` in `src/index.ts` (which does not run under
 * Vitest) and additionally guards on `VITEST`. Tests drive sync deterministically
 * via `runCalendarSync` / the manual `POST /api/v1/m365/sync` route instead.
 *
 * A tick runs all feeds sequentially; per-feed errors are already isolated and
 * recorded by the runner, so a tick cannot crash the loop or the app. The timer
 * is `unref`'d so it never keeps the process alive on its own.
 */

export interface SchedulerHandle {
  stop(): void;
}

let handle: SchedulerHandle | null = null;

export function startM365Scheduler(): SchedulerHandle | null {
  if (process.env['VITEST'] !== undefined) return null;
  if (!isM365Enabled()) return null;
  if (handle) return handle; // idempotent

  const seconds = Math.max(60, config.m365SyncIntervalSeconds);

  const tick = () => {
    // Calendar then tasks, sequentially, in one tick. The runners never reject
    // for per-feed failures; guard anyway so an unexpected error (e.g. an
    // app-only token failure surfaced by listFeeds) can't crash the process.
    runCalendarSync()
      .catch((e) => logError('m365 calendar sync tick failed', e))
      .then(() => runTaskSync())
      .catch((e) => logError('m365 task sync tick failed', e));
  };

  const timer = setInterval(tick, seconds * 1000);
  timer.unref?.();
  // Kick an initial sync shortly after boot (not synchronously — let the server
  // finish starting first).
  const kickoff = setTimeout(tick, 2000);
  kickoff.unref?.();

  handle = {
    stop() {
      clearInterval(timer);
      clearTimeout(kickoff);
      handle = null;
    },
  };
  return handle;
}

/** Stop the scheduler if running (idempotent). */
export function stopM365Scheduler(): void {
  handle?.stop();
}

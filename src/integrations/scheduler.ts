import { config } from '../config/env.js';
import { logError } from '@wyrhta/core/lib';
import { listProviders } from './registry.js';

/**
 * Background poll loop for every registered provider's mirrors. Started at boot
 * from `main()` in `src/index.ts` and NEVER in tests — that entrypoint does not
 * run under Vitest, and this additionally guards on `VITEST`. Tests drive sync
 * deterministically via a provider's runners or `POST /api/v1/integrations/sync`.
 *
 * A tick runs every provider's calendar feeds then its task feeds, sequentially.
 * Per-feed errors are already isolated and recorded by the runner, so a tick
 * cannot crash the loop or the app. The timer is `unref`'d so it never keeps the
 * process alive on its own.
 */

export interface SchedulerHandle {
  stop(): void;
}

let handle: SchedulerHandle | null = null;

export function startIntegrationsScheduler(): SchedulerHandle | null {
  if (process.env['VITEST'] !== undefined) return null;
  if (listProviders().length === 0) return null;
  if (handle) return handle; // idempotent

  const seconds = Math.max(60, config.integrationsSyncIntervalSeconds);

  const tick = () => {
    void (async () => {
      for (const p of listProviders()) {
        // The runners never reject for per-feed failures; guard anyway so an
        // unexpected error (e.g. a token failure surfaced while enumerating
        // feeds) cannot take down the loop or a sibling provider's tick.
        try {
          await p.runCalendarSync();
        } catch (e) {
          logError(`${p.id} calendar sync tick failed`, e);
        }
        try {
          await p.runTaskSync();
        } catch (e) {
          logError(`${p.id} task sync tick failed`, e);
        }
      }
    })();
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
export function stopIntegrationsScheduler(): void {
  handle?.stop();
}

import { logError } from '@wyrhta/core/lib';
import { config } from '../../../config/env.js';
import { runImportTick } from './sync.js';

/**
 * Poll loop for the bank-line source. Gated on `config.feohImport` (the
 * FEOH_IMPORT_ENABLED kill switch) and never started under tests. Reuses the
 * integrations poll interval; floored at 60s like that scheduler.
 */
export interface SchedulerHandle { stop(): void }

let handle: SchedulerHandle | null = null;

export function startFeohImportScheduler(): SchedulerHandle | null {
  if (process.env['VITEST'] !== undefined) return null;
  if (config.feohImport === null) return null;
  if (handle) return handle;

  const seconds = Math.max(60, config.integrationsSyncIntervalSeconds);
  const tick = () => {
    // runImportTick never rejects; guard anyway so a Heorth bug cannot kill the loop.
    runImportTick().catch((e) => logError('feoh import tick crashed', e));
  };
  const timer = setInterval(tick, seconds * 1000);
  timer.unref?.();
  const kickoff = setTimeout(tick, 5000);
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

export function stopFeohImportScheduler(): void {
  handle?.stop();
}

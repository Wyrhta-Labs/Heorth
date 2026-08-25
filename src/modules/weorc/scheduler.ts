import { logError } from '@wyrhta/core/lib';
import { runWeorcTick } from './engine.js';

/**
 * Weorc's poll loop. Unlike the M365 scheduler this is NOT gated on
 * `isM365Enabled()` - materialising due work, completing it and keeping its
 * history are Heorth-native and must run without a task provider attached.
 */

const INTERVAL_SECONDS = 3600;

export interface SchedulerHandle {
  stop(): void;
}

let handle: SchedulerHandle | null = null;

export function startWeorcScheduler(): SchedulerHandle | null {
  if (process.env['VITEST'] !== undefined) return null;
  if (handle) return handle;

  const tick = () => {
    runWeorcTick().catch((e) => logError('weorc tick failed', e));
  };

  const timer = setInterval(tick, INTERVAL_SECONDS * 1000);
  timer.unref?.();
  const kickoff = setTimeout(tick, 3000);
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

export function stopWeorcScheduler(): void {
  handle?.stop();
}

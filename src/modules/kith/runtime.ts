import { config, type KithConfig } from '../../config/env.js';
import { KithClient } from './client.js';

/**
 * The live KithLedger dependencies route handlers resolve per request — the
 * same `get*Runtime`/`set*Runtime` seam as `src/m365/runtime.ts`, so tests
 * install a fake-KithLedger-backed runtime and never touch the network.
 */
export interface KithRuntime {
  config: KithConfig;
  client: KithClient;
}

/** Whether the integration is configured (both KITH_* env vars present). */
export function isKithEnabled(): boolean {
  return config.kith !== null;
}

/**
 * Assemble a runtime from an explicit config + fetch (production uses the
 * validated env config and the global fetch; tests pass a fake-KithLedger fetch).
 */
export function createKithRuntime(cfg: KithConfig, fetchImpl: typeof fetch = fetch): KithRuntime {
  return {
    config: cfg,
    client: new KithClient({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, fetch: fetchImpl }),
  };
}

let runtime: KithRuntime | null = null;

/**
 * Lazily-initialized singleton. Only valid when the integration is enabled;
 * callers behind the enabled gate (the mounted routes) can rely on it.
 */
export function getKithRuntime(): KithRuntime {
  if (!runtime) {
    if (!config.kith) {
      throw new Error('KithLedger integration is disabled (no KITH_* env) — getKithRuntime must not be called');
    }
    runtime = createKithRuntime(config.kith);
  }
  return runtime;
}

/** Test seam: install a runtime backed by a fake KithLedger (or null to reset). */
export function setKithRuntime(next: KithRuntime | null): void {
  runtime = next;
}

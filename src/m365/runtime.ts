import { config, type M365Config } from '../config/env.js';
import { graphFetch } from './graph.js';
import { M365Store } from './store.js';
import { DelegatedClient } from './delegated.js';
import { AppOnlyClient } from './app-only.js';

/**
 * The live M365 dependencies route handlers and (later) providers resolve per
 * request. Consumers in Tasks 2.2/2.3 depend only on this surface:
 *  - `config`     — resolved M365 settings (tenant, family mailbox, shared list).
 *  - `store`      — connections + generic sync state (see `store.ts`).
 *  - `delegated`  — per-member access tokens (auth-code flow).
 *  - `appOnly`    — tenant-scoped token for the family mailbox.
 *  - `graphFetch` — bearer JSON call with 429 retry + typed GraphError mapping.
 */
export interface M365Runtime {
  config: M365Config;
  store: M365Store;
  delegated: DelegatedClient;
  appOnly: AppOnlyClient;
  graphFetch: <T>(accessToken: string, path: string, init?: RequestInit) => Promise<T>;
}

/** Whether the integration is configured (all M365_* env present). */
export function isM365Enabled(): boolean {
  return config.m365 !== null;
}

/**
 * Assemble a runtime from an explicit config + fetch (production uses the
 * validated env config and the global fetch; tests pass a fake-Graph fetch).
 */
export function createM365Runtime(cfg: M365Config, fetchImpl: typeof fetch = fetch): M365Runtime {
  const store = new M365Store();
  const delegated = new DelegatedClient(cfg, store, fetchImpl);
  const appOnly = new AppOnlyClient(cfg, fetchImpl);
  return {
    config: cfg,
    store,
    delegated,
    appOnly,
    graphFetch: <T>(accessToken: string, path: string, init?: RequestInit) =>
      graphFetch<T>({ fetch: fetchImpl }, accessToken, path, init),
  };
}

let runtime: M365Runtime | null = null;

/**
 * Lazily-initialized singleton. Only valid when the integration is enabled;
 * callers behind the enabled gate (the mounted routes) can rely on it. Resolved
 * per request so tests can swap in a fake-Graph-backed runtime.
 */
export function getM365Runtime(): M365Runtime {
  if (!runtime) {
    if (!config.m365) {
      throw new Error('M365 integration is disabled (no M365_* env) — getM365Runtime must not be called');
    }
    runtime = createM365Runtime(config.m365);
  }
  return runtime;
}

/** Test seam: install a runtime backed by a fake Graph (or null to reset). */
export function setM365Runtime(next: M365Runtime | null): void {
  runtime = next;
}

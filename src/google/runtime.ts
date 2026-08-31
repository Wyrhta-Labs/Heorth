import { config, type GoogleConfig } from '../config/env.js';
import { IntegrationStore } from '../integrations/store.js';
import { googleFetch } from './api.js';
import { GoogleOAuthClient } from './oauth.js';

/**
 * The live Google dependencies the provider implementations resolve per call —
 * the exact sibling of `src/m365/runtime.ts`:
 *  - `config`      — resolved Google settings.
 *  - `store`       — connections + generic sync state, scoped to 'google'.
 *  - `oauth`       — per-member access tokens (auth-code flow).
 *  - `googleFetch` — bearer JSON call with 429 retry + typed GoogleApiError.
 *
 * There is no app-only client: Google's household calendar is a DELEGATED feed
 * designated on one member's connection, deliberately, so this works for a
 * consumer Gmail account with no Workspace domain-wide delegation.
 */
export interface GoogleRuntime {
  config: GoogleConfig;
  store: IntegrationStore;
  oauth: GoogleOAuthClient;
  googleFetch: <T>(accessToken: string, url: string, init?: RequestInit) => Promise<T>;
}

/** Whether the integration is configured (all GOOGLE_* env present). */
export function isGoogleEnabled(): boolean {
  return config.google !== null;
}

/** Assemble a runtime from an explicit config + fetch (tests pass a fake). */
export function createGoogleRuntime(cfg: GoogleConfig, fetchImpl: typeof fetch = fetch): GoogleRuntime {
  const store = new IntegrationStore('google');
  const oauth = new GoogleOAuthClient(cfg, store, fetchImpl);
  return {
    config: cfg,
    store,
    oauth,
    googleFetch: <T>(accessToken: string, url: string, init?: RequestInit) =>
      googleFetch<T>({ fetch: fetchImpl }, accessToken, url, init),
  };
}

let runtime: GoogleRuntime | null = null;

/** Lazily-initialized singleton; only valid when the integration is enabled. */
export function getGoogleRuntime(): GoogleRuntime {
  if (!runtime) {
    if (!config.google) {
      throw new Error('Google integration is disabled (no GOOGLE_* env) — getGoogleRuntime must not be called');
    }
    runtime = createGoogleRuntime(config.google);
  }
  return runtime;
}

/** Test seam: install a runtime backed by a fake Google (or null to reset). */
export function setGoogleRuntime(next: GoogleRuntime | null): void {
  runtime = next;
}

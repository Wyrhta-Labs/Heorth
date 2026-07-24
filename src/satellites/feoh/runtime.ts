import { SatelliteClient } from '../satellite-client.js';
import { config } from '../../config/env.js';
import { householdCore } from '../../wiring.js';
import { FeohClient } from './client.js';
import { FeohRoster } from './roster.js';

/** The live Feoh dependencies the proxy resolves per request. */
export interface FeohRuntime {
  client: FeohClient;
  roster: FeohRoster;
}

let runtime: FeohRuntime | null = null;

/** Build the runtime from validated env config + the household member list. */
export function createFeohRuntimeFromConfig(): FeohRuntime {
  const http = new SatelliteClient({
    baseUrl: config.feohBaseUrl,
    apiKey: config.feohApiKey,
    timeoutMs: 5000,
  });
  const client = new FeohClient(http);
  const roster = new FeohRoster(client, () => householdCore.listMembers());
  return { client, roster };
}

/**
 * Lazily-initialized singleton so route handlers and the startup sync share one
 * roster cache. Resolved per request (not captured at mount time) so tests can
 * swap in a fake-Feoh-backed runtime before issuing requests.
 */
export function getFeohRuntime(): FeohRuntime {
  if (!runtime) runtime = createFeohRuntimeFromConfig();
  return runtime;
}

/** Test seam: install a runtime backed by a fake Feoh (or null to reset). */
export function setFeohRuntime(next: FeohRuntime | null): void {
  runtime = next;
}

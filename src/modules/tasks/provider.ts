import type { TaskProvider } from './providers/types.js';

/**
 * Provider seam for the write paths (completion + creation + list discovery).
 * The sync runner constructs its own provider, but the module's REST/MCP write
 * handlers resolve the provider through this seam so the module never imports a
 * Graph type. When the M365 integration is enabled, `m365Module.register`
 * installs the Graph provider here (plus the configured shared-list display
 * name); tests install a fake-backed one. When the integration is disabled the
 * seam stays null and write paths return a classified `provider_unavailable`
 * error (reads still work off the mirror).
 *
 * The shared-list name travels with the provider (rather than being read from
 * the global config) so it is resolved from the SAME source as the provider —
 * keeping the module free of the M365 config and test-injectable.
 */
let provider: TaskProvider | null = null;
let sharedListName: string | null = null;

/** Install (or clear) the active task provider + the shared household list name. */
export function setTaskProvider(next: TaskProvider | null, shared: string | null = null): void {
  provider = next;
  sharedListName = shared;
}

/** The active task provider, or null when the integration is disabled. */
export function getTaskProvider(): TaskProvider | null {
  return provider;
}

/** The configured shared household list display name, or null when disabled. */
export function getSharedListName(): string | null {
  return sharedListName;
}

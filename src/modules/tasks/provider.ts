import type { TaskProvider } from './providers/types.js';
import { TaskProviderError } from './providers/types.js';
import { getTaskProviderFor } from '../../integrations/registry.js';

/**
 * Provider resolution for the tasks write paths (completion, creation, list
 * discovery).
 *
 * This used to be a single global slot holding "the" provider, installed by the
 * M365 module. That could only ever be correct with one provider configured:
 * completing a Google-mirrored task would have been written to whichever
 * provider registered last. Resolution is now BY THE MIRROR ROW'S `source`, via
 * the integrations registry.
 *
 * When no provider is registered for a source, write paths get a classified
 * `provider_unavailable` error and reads still work off the mirror.
 */
export function getProviderFor(source: string): TaskProvider | null {
  return getTaskProviderFor(source);
}

export function requireProviderFor(source: string): TaskProvider {
  const p = getTaskProviderFor(source);
  if (!p) {
    throw new TaskProviderError(
      'provider_unavailable',
      `No task provider is available for source "${source}"`,
    );
  }
  return p;
}

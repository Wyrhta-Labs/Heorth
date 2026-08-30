import type { IntegrationStore } from './store.js';
import type { FeedSyncResult } from './sync-runner.js';
import type { CalendarProvider } from '../modules/calendar/providers/types.js';
import type { TaskProvider } from '../modules/tasks/providers/types.js';

/**
 * One registered external provider. Replaces the single global `setTaskProvider`
 * slot, which could only ever hold one implementation process-wide — the reason
 * M365 and Google could not previously coexist.
 *
 * A provider registers itself from its module's `register()` when its env group
 * is present. Nothing here knows about any specific upstream API: the provider
 * supplies its own transport, auth, error classification and sync cadence.
 */
export interface RegisteredProvider {
  /** Stable id, matching the `source` column on both mirror tables ('m365' | 'google'). */
  id: string;
  store: IntegrationStore;
  /** Maps a thrown value to a short safe reason token. Never token material. */
  classifyError: (e: unknown) => string;
  fullResyncIntervalMs: number;

  /** Consent URL for the connect redirect; `state` binds the member. */
  authorizeUrl: (state: string) => string;
  /**
   * Exchange the callback code and resolve the account identity. Throws on any
   * failure — the caller redirects with a generic error rather than surfacing
   * upstream detail, which may reference tokens.
   */
  completeConnect: (code: string) => Promise<{
    accountLabel: string; refreshToken: string; scopes: string;
  }>;

  /** Null when this provider does not offer that surface. */
  calendar: CalendarProvider | null;
  tasks: TaskProvider | null;

  runCalendarSync: () => Promise<FeedSyncResult[]>;
  runTaskSync: () => Promise<FeedSyncResult[]>;
}

// Insertion-ordered, so listProviders() is stable and the scheduler ticks
// providers in registration order.
const providers = new Map<string, RegisteredProvider>();

/** Register (or replace) a provider. Idempotent per id. */
export function registerProvider(p: RegisteredProvider): void {
  providers.set(p.id, p);
}

export function getProvider(id: string): RegisteredProvider | null {
  return providers.get(id) ?? null;
}

export function listProviders(): RegisteredProvider[] {
  return [...providers.values()];
}

/** Test seam: drop every registration. */
export function clearProviders(): void {
  providers.clear();
}

/**
 * The task provider for a mirror row's `source`. This is the lookup that makes
 * write-back correct with two providers connected: completing a Google-mirrored
 * task must reach Google, not whichever provider happened to register last.
 * Null when the provider is absent or offers no task surface — callers turn that
 * into a classified `provider_unavailable`.
 */
export function getTaskProviderFor(source: string): TaskProvider | null {
  return providers.get(source)?.tasks ?? null;
}

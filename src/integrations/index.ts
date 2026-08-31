import type { Hono } from 'hono';
import type { HeorthModule } from '../modules/registry.js';
import { integrationsRouter } from './routes.js';
import { listProviders } from './registry.js';

/**
 * The integrations area. Always registers — unlike the old m365 module it is not
 * gated on any one provider's env group, because it hosts the routes for ALL
 * providers. With no provider registered, `/status` reports empty lists and
 * `/:provider/*` 404s, which is the honest answer.
 *
 * Providers register themselves from their own module's `register()`. Module
 * order in `ALL_MODULES` therefore matters: provider modules must be listed
 * BEFORE this one so their registrations exist when a request arrives.
 */
export const integrationsModule: HeorthModule = {
  name: 'integrations',
  register(app: Hono): void {
    app.route('/api/v1/integrations', integrationsRouter);
  },
};

export { registerProvider, getProvider, listProviders, clearProviders, getTaskProviderFor,
  type RegisteredProvider } from './registry.js';
export { IntegrationStore, type PublicIntegrationConnection } from './store.js';
export { feedKeys } from './feed-keys.js';
export {
  syncOneFeed, isFullResyncDue, DEFAULT_FULL_RESYNC_INTERVAL_MS,
  type FeedSyncResult, type RunnableFeed, type FeedPullOutcome, type SyncDeps,
} from './sync-runner.js';
export type {
  IntegrationConnectionRow, IntegrationSyncStateRow, IntegrationConnectionStatus,
} from './schema.js';

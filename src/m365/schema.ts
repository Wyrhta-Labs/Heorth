/**
 * TEMPORARY SHIM — the tables moved to `src/integrations/schema.ts` when the
 * provider-neutral integrations layer was extracted. This file exists only so
 * the extraction can land in reviewable steps; it is deleted in the task that
 * rewires `src/m365/` onto the new layer. Do not add anything here.
 */
export {
  integrationConnections as m365Connections,
  integrationSyncState as m365SyncState,
  INTEGRATION_CONNECTION_STATUSES as M365_CONNECTION_STATUSES,
} from '../integrations/schema.js';
export type {
  IntegrationConnectionRow as M365ConnectionRow,
  IntegrationSyncStateRow as M365SyncStateRow,
  IntegrationConnectionStatus as M365ConnectionStatus,
} from '../integrations/schema.js';

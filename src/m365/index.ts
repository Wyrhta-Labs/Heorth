import type { HeorthModule } from '../modules/registry.js';
import { getM365Runtime, isM365Enabled } from './runtime.js';
import { GraphCalendarProvider } from './calendar-provider.js';
import { GraphTaskProvider } from './task-provider.js';
import { setTaskProvider } from '../modules/tasks/provider.js';
import { registerProvider } from '../integrations/registry.js';
import { runCalendarSync } from './calendar-sync.js';
import { runTaskSync } from './task-sync.js';
import { classify, m365FullResyncIntervalMs } from './sync-runner.js';

/**
 * The Microsoft 365 area registers as a module but is a NO-OP when the
 * integration is disabled (no `M365_*` env). When enabled it registers itself
 * as a provider into the integrations registry (mounted routes now live at
 * `/api/v1/integrations`, see `src/integrations`) AND installs the Graph To Do
 * provider into the tasks module's write-path seam (the tasks module never
 * imports a Graph type itself).
 */
export const m365Module: HeorthModule = {
  name: 'm365',
  register(): void {
    if (!isM365Enabled()) return;
    const rt = getM365Runtime();
    registerProvider({
      id: 'm365',
      store: rt.store,
      classifyError: classify,
      fullResyncIntervalMs: m365FullResyncIntervalMs(),
      authorizeUrl: (state) => rt.delegated.authorizeUrl(state),
      completeConnect: async (code) => {
        const { refreshToken, accessToken, scopes } = await rt.delegated.exchangeCode(code);
        const me = await rt.delegated.getMe(accessToken);
        return { accountLabel: me.userPrincipalName, refreshToken, scopes };
      },
      calendar: new GraphCalendarProvider(rt),
      tasks: new GraphTaskProvider(rt),
      runCalendarSync: () => runCalendarSync(rt),
      runTaskSync: () => runTaskSync(rt),
    });
    setTaskProvider(new GraphTaskProvider(rt), rt.config.sharedTodoList);
  },
};

// Public surface for Tasks 2.2/2.3 (calendar + To Do providers).
export { getM365Runtime, setM365Runtime, createM365Runtime, isM365Enabled, type M365Runtime } from './runtime.js';
export { startM365Scheduler, stopM365Scheduler, type SchedulerHandle } from './scheduler.js';
export { runCalendarSync } from './calendar-sync.js';
export { runTaskSync } from './task-sync.js';
export type { FeedSyncResult } from './sync-runner.js';
export { GraphCalendarProvider } from './calendar-provider.js';
export { GraphTaskProvider } from './task-provider.js';
export { GraphError, graphFetch, GRAPH_BASE } from './graph.js';
export { DELEGATED_SCOPES } from './delegated.js';
export type { GraphMe } from './delegated.js';
export { IntegrationStore, type PublicIntegrationConnection } from '../integrations/store.js';
export { feedKeys } from '../integrations/feed-keys.js';
export type {
  IntegrationConnectionRow, IntegrationSyncStateRow, IntegrationConnectionStatus,
} from '../integrations/schema.js';

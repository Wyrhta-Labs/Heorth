import type { Hono } from 'hono';
import type { HeorthModule, McpRegistry } from '../modules/registry.js';
import { m365Router } from './routes.js';
import { isM365Enabled } from './runtime.js';

/**
 * The Microsoft 365 area registers as a module but is a NO-OP when the
 * integration is disabled (no `M365_*` env). Disabled means zero impact: no
 * routes are mounted, so `/api/v1/m365/*` returns the app's catch-all 404 and
 * boot/tests are unaffected. When enabled it mounts the connection routes.
 *
 * Task 2.2/2.3 will contribute calendar/task MCP tools here.
 */
export const m365Module: HeorthModule = {
  name: 'm365',
  register(app: Hono, _mcp: McpRegistry): void {
    if (!isM365Enabled()) return;
    app.route('/api/v1/m365', m365Router);
  },
};

// Public surface for Tasks 2.2/2.3 (calendar + To Do providers).
export { getM365Runtime, setM365Runtime, createM365Runtime, isM365Enabled, type M365Runtime } from './runtime.js';
export { feedKeys } from './feed-keys.js';
export { GraphError, graphFetch, GRAPH_BASE } from './graph.js';
export { M365Store, type PublicM365Connection } from './store.js';
export { DELEGATED_SCOPES } from './delegated.js';
export type { GraphMe } from './delegated.js';
export type { M365ConnectionRow, M365SyncStateRow, M365ConnectionStatus } from './schema.js';

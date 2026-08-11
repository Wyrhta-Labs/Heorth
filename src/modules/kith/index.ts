import type { Hono } from 'hono';
import type { HeorthModule, McpRegistry } from '../registry.js';
import { isKithEnabled } from './runtime.js';
import { kithRouter } from './routes.js';

/** KithLedger reminders module. Disabled (KITH_* env absent, the default):
 *  registers nothing — routes fall through to the /api catch-all 404, UI hides
 *  via GET /api/v1/features (`kithledger`). Stateless live proxy: no DB, no
 *  MCP tools; enabling/disabling never touches data. */
export const kithModule: HeorthModule = {
  name: 'kith',
  register(app: Hono, _mcp: McpRegistry): void {
    if (!isKithEnabled()) return;
    app.route('/api/v1/kith', kithRouter);
  },
};

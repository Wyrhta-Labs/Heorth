import type { Hono } from 'hono';
import { config } from '../../config/env.js';
import type { HeorthModule, McpRegistry } from '../registry.js';
import { feohRouter } from './routes.js';
import { feohTools } from './mcp.js';

/** Finance module (ADR 0007). Disabled (default): registers nothing — routes
 *  fall through to the /api catch-all 404, no MCP tools, UI hides via
 *  GET /api/v1/features. Data is never touched by the toggle. */
export const feohModule: HeorthModule = {
  name: 'feoh',
  register(app: Hono, mcp: McpRegistry): void {
    if (!config.feohEnabled) return;
    app.route('/api/v1/feoh', feohRouter);
    mcp.add(...feohTools);
  },
};

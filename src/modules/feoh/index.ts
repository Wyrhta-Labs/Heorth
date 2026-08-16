import type { Hono } from 'hono';
import type { HeorthModule, McpRegistry } from '../registry.js';
import { feohRouter } from './routes.js';
import { feohTools } from './mcp.js';

/** Finance module (ADR 0007). Always on since the env-gate kill switch was
 *  removed (2026-08-16 spec) — registers routes and MCP tools unconditionally. */
export const feohModule: HeorthModule = {
  name: 'feoh',
  register(app: Hono, mcp: McpRegistry): void {
    app.route('/api/v1/feoh', feohRouter);
    mcp.add(...feohTools);
  },
};

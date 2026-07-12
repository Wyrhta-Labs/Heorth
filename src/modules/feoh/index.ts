import type { Hono } from 'hono';
import type { HeorthModule, McpRegistry } from '../registry.js';
import { feohRouter } from './routes.js';
import { feohTools } from './mcp.js';

export const feohModule: HeorthModule = {
  name: 'feoh',
  register(app: Hono, mcp: McpRegistry): void {
    app.route('/api/v1/feoh', feohRouter);
    mcp.add(...feohTools);
  },
};

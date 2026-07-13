import type { Hono } from 'hono';
import type { HeorthModule, McpRegistry } from '../registry.js';
import { libraryRouter } from './routes.js';
import { libraryTools } from './mcp.js';

export const libraryModule: HeorthModule = {
  name: 'library',
  register(app: Hono, mcp: McpRegistry): void {
    app.route('/api/v1/library', libraryRouter);
    mcp.add(...libraryTools);
  },
};

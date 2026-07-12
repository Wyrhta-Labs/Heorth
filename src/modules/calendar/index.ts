import type { Hono } from 'hono';
import type { HeorthModule, McpRegistry } from '../registry.js';
import { calendarRouter } from './routes.js';
import { calendarTools } from './mcp.js';

export const calendarModule: HeorthModule = {
  name: 'calendar',
  register(app: Hono, mcp: McpRegistry): void {
    app.route('/api/v1/events', calendarRouter);
    mcp.add(...calendarTools);
  },
};

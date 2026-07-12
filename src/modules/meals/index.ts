import type { Hono } from 'hono';
import type { HeorthModule, McpRegistry } from '../registry.js';
import { recipesRouter, mealsRouter } from './routes.js';
import { mealsTools } from './mcp.js';

export const mealsModule: HeorthModule = {
  name: 'meals',
  register(app: Hono, mcp: McpRegistry): void {
    app.route('/api/v1/recipes', recipesRouter);
    app.route('/api/v1/meals', mealsRouter);
    mcp.add(...mealsTools);
  },
};

import type { Hono } from 'hono';
import type { HeorthModule } from '../registry.js';
import { recipesRouter, mealsRouter } from './routes.js';

export const mealsModule: HeorthModule = {
  name: 'meals',
  register(app: Hono): void {
    app.route('/api/v1/recipes', recipesRouter);
    app.route('/api/v1/meals', mealsRouter);
  },
};

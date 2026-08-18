import type { Hono } from 'hono';
import type { HeorthModule } from '../registry.js';
import { tasksRouter } from './routes.js';

/**
 * The Tasks module — the household task surface backed by Microsoft To Do (the
 * system of record). It always registers (like the calendar module): reads work
 * off the mirror even when M365 is disabled (empty), and the write paths return a
 * classified `PROVIDER_UNAVAILABLE` error until the integration is enabled and
 * `m365Module.register` installs the Graph provider into the seam.
 */
export const tasksModule: HeorthModule = {
  name: 'tasks',
  register(app: Hono): void {
    app.route('/api/v1/tasks', tasksRouter);
  },
};

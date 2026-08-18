import type { Hono } from 'hono';
import type { HeorthModule } from '../registry.js';
import { calendarRouter } from './routes.js';

export const calendarModule: HeorthModule = {
  name: 'calendar',
  register(app: Hono): void {
    app.route('/api/v1/events', calendarRouter);
  },
};

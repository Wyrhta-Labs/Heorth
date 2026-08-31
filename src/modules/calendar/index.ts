import type { Hono } from 'hono';
import type { HeorthModule } from '../registry.js';
import { calendarRouter } from './routes.js';
import { calendarAllowlistRouter } from './allowlist-routes.js';

export const calendarModule: HeorthModule = {
  name: 'calendar',
  register(app: Hono): void {
    app.route('/api/v1/events', calendarRouter);
    // Discovery/allowlist lives under its own path: `/api/v1/events/calendars`
    // would be a nonsense URL for "which calendars do I sync".
    app.route('/api/v1/calendar', calendarAllowlistRouter);
  },
};

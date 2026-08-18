import type { Hono } from 'hono';
import type { HeorthModule } from '../registry.js';
import { inventoryRouter } from './routes.js';

/** Household inventory (spec 2026-08-16). Standalone and always on; feoh
 *  references inventory, never the reverse. */
export const inventoryModule: HeorthModule = {
  name: 'inventory',
  register(app: Hono): void {
    app.route('/api/v1/inventory', inventoryRouter);
  },
};

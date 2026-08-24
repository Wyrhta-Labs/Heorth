import type { Hono } from 'hono';
import type { HeorthModule } from '../registry.js';
import { ethelRouter } from './routes.js';

/** Ethel — the physical property: assets, places, and detail rows (ADR 0013).
 *  Standalone and always on; feoh references ethel, never the reverse. */
export const ethelModule: HeorthModule = {
  name: 'ethel',
  register(app: Hono): void {
    app.route('/api/v1/ethel', ethelRouter);
  },
};

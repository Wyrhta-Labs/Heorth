import type { Hono } from 'hono';
import type { HeorthModule } from '../registry.js';
import { feohRouter } from './routes.js';

/** Finance module (ADR 0007). Always on since the env-gate kill switch was
 *  removed (2026-08-16 spec) — registers its routes unconditionally. */
export const feohModule: HeorthModule = {
  name: 'feoh',
  register(app: Hono): void {
    app.route('/api/v1/feoh', feohRouter);
  },
};

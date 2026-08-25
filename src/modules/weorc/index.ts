import type { Hono } from 'hono';
import type { HeorthModule } from '../registry.js';
import { weorcRouter } from './routes.js';

/** Weorc - recurring household work, always on like Feoh and Ethel. */
export const weorcModule: HeorthModule = {
  name: 'weorc',
  register(app: Hono): void {
    app.route('/api/v1/weorc', weorcRouter);
  },
};

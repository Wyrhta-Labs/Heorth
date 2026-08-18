import type { Hono } from 'hono';
import type { HeorthModule } from '../registry.js';
import { libraryRouter } from './routes.js';

export const libraryModule: HeorthModule = {
  name: 'library',
  register(app: Hono): void {
    app.route('/api/v1/library', libraryRouter);
  },
};

import type { Hono } from 'hono';
import type { HeorthModule } from '../modules/registry.js';
import { householdRouter, membersRouter, authRouter } from './routes.js';

export const householdModule: HeorthModule = {
  name: 'household',
  register(app: Hono): void {
    app.route('/api/v1/household', householdRouter);
    app.route('/api/v1/members', membersRouter);
    app.route('/api/v1/auth', authRouter);
  },
};

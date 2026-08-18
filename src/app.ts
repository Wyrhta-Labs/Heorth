import { Hono } from 'hono';
import type { ErrorHandler } from 'hono';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { trimTrailingSlash } from 'hono/trailing-slash';
import { serveStatic } from '@hono/node-server/serve-static';
import { requestId, securityHeaders, errorHandler } from '@wyrhta/core/http';
import type { Role } from '@wyrhta/core/identity';
import { config } from './config/env.js';
import { healthRouter } from './routes/health.js';
import { featuresRouter } from './routes/features.js';
import { jwksRouter } from './routes/jwks.js';
import type { HeorthModule } from './modules/registry.js';
import { MaintenanceAdminError } from './household/maintenance-admin.js';

declare module 'hono' {
  interface ContextVariableMap {
    auth: {
      type: 'api_key' | 'jwt';
      userId: string;
      role: Role;
      apiKeyId?: string;
    };
    requestId: string;
  }
}

/**
 * Core's errorHandler only classifies ZodError; anything else becomes a 500.
 * Core is a pinned dependency, so the quarantine's 403 is mapped here instead
 * of in every route — this also covers routes added later for free.
 */
export const heorthErrorHandler: ErrorHandler = (error, c) => {
  if (error instanceof MaintenanceAdminError) {
    return c.json({ error: { code: error.code, message: error.message } }, 403);
  }
  return errorHandler(error, c);
};

export function createApp(modules: HeorthModule[]): Hono {
  const app = new Hono();

  app.use('*', trimTrailingSlash());
  app.use('*', requestId);
  app.use('*', securityHeaders);
  app.use('*', logger());
  app.use('*', cors({ origin: config.corsOrigin }));
  app.use('/api/*', bodyLimit({ maxSize: 1024 * 1024 }));

  app.route('/', healthRouter);
  // Public JWKS for satellite identity — unauthenticated by design, and
  // mounted outside /api/v1 so no guard or catch-all applies (see jwks.ts).
  app.route('/', jwksRouter);
  app.route('/api/v1/features', featuresRouter);

  for (const mod of modules) {
    mod.register(app);
  }

  app.all('/api/*', (c) =>
    c.json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }, 404)
  );

  app.use('/*', serveStatic({ root: './web/dist' }));
  app.get('/*', serveStatic({ root: './web/dist', rewriteRequestPath: () => '/index.html' }));

  app.onError(heorthErrorHandler);

  return app;
}

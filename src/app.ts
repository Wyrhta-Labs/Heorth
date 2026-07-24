import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { trimTrailingSlash } from 'hono/trailing-slash';
import { serveStatic } from '@hono/node-server/serve-static';
import { requestId, securityHeaders, errorHandler } from '@wyrhta/core/http';
import type { Role } from '@wyrhta/core/identity';
import { config } from './config/env.js';
import { healthRouter } from './routes/health.js';
import { McpRegistry, type HeorthModule } from './modules/registry.js';
import { createFeohProxyRouter } from './satellites/feoh/proxy.js';

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

export function createApp(modules: HeorthModule[]): Hono {
  const app = new Hono();

  app.use('*', trimTrailingSlash());
  app.use('*', requestId);
  app.use('*', securityHeaders);
  app.use('*', logger());
  app.use('*', cors({ origin: config.corsOrigin }));
  app.use('/api/*', bodyLimit({ maxSize: 1024 * 1024 }));

  app.route('/', healthRouter);

  const mcp = new McpRegistry();
  for (const mod of modules) {
    mod.register(app, mcp);
  }

  // Feoh is no longer an in-process module — its finance domain lives in the
  // Feoh satellite service. Heorth mounts a transparent proxy at the same paths.
  app.route('/api/v1/feoh', createFeohProxyRouter());

  app.all('/api/*', (c) =>
    c.json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }, 404)
  );

  app.use('/*', serveStatic({ root: './web/dist' }));
  app.get('/*', serveStatic({ root: './web/dist', rewriteRequestPath: () => '/index.html' }));

  app.onError(errorHandler);

  return app;
}

/** Build the MCP tool registry from the same modules used for REST. */
export function collectMcpTools(modules: HeorthModule[]): McpRegistry {
  const mcp = new McpRegistry();
  const throwaway = new Hono();
  for (const mod of modules) {
    mod.register(throwaway, mcp);
  }
  return mcp;
}

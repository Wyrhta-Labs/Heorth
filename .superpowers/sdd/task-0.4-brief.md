### Task 0.4: App factory, health route & module registry contract

**Files:**
- Create: `src/app.ts`, `src/routes/health.ts`, `src/modules/registry.ts`
- Test: `tests/health.test.ts`

**Interfaces:**
- Consumes: core middleware (`requestId`, `securityHeaders`, `errorHandler`), `config`.
- Produces: `createApp(modules: HeorthModule[])`; `HeorthModule` and `McpRegistry` types; `ContextVariableMap` augmentation with `auth` + `requestId`. Health at `GET /health`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/health.test.ts
import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app.js';

describe('health', () => {
  const app = createApp([]);

  it('returns ok from /health', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { status: string } };
    expect(body.data.status).toBe('ok');
  });

  it('returns JSON 404 for unknown api routes', async () => {
    const res = await app.request('/api/v1/nope');
    expect(res.status).toBe(404);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/health.test.ts`
Expected: FAIL — `createApp` not found.

- [ ] **Step 3: Write `src/modules/registry.ts`**

```ts
import type { Hono } from 'hono';
import type { McpTool } from '@wyrhta/core/mcp';

/** Mutable collection a module pushes its MCP tools into during registration. */
export class McpRegistry {
  private tools: McpTool[] = [];
  add(...tools: McpTool[]): void {
    this.tools.push(...tools);
  }
  all(): McpTool[] {
    return [...this.tools];
  }
}

/**
 * Module convention: each module exports `register(app, mcpRegistry)` mounting
 * its REST routes and contributing its MCP tools. Compile-time registration only.
 */
export interface HeorthModule {
  name: string;
  register(app: Hono, mcp: McpRegistry): void;
}
```

- [ ] **Step 4: Write `src/routes/health.ts`**

```ts
import { Hono } from 'hono';
import { ok } from '@wyrhta/core/http';

export const healthRouter = new Hono();

healthRouter.get('/health', (c) => ok(c, { status: 'ok' }));
```

- [ ] **Step 5: Write `src/app.ts`**

```ts
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
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- tests/health.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add src/app.ts src/routes/health.ts src/modules/registry.ts tests/health.test.ts
git commit -m "feat: add app factory, health route, and module registry contract"
```

---


### Task 0.5: Boot sequence (`index.ts`)

**Files:**
- Create: `src/index.ts`, `src/modules/index.ts`
- Test: `tests/bootstrap.test.ts`

**Interfaces:**
- Consumes: `db`, `config`, `createHouseholdService`, `createIdentityService`, `createApp`, `collectMcpTools`, `createMcpServer`.
- Produces: `bootstrap()` — runs migrations, seeds household+admin (idempotent), returns `{ app, mcpServer }`. `ALL_MODULES` array (empty for now; modules appended in later phases).

- [ ] **Step 1: Write the failing test**

```ts
// tests/bootstrap.test.ts
import { describe, it, expect } from 'vitest';
import { bootstrap } from '../src/index.js';
import { createHouseholdService } from '@wyrhta/core/household';
import { createIdentityService } from '@wyrhta/core/identity';
import { db } from '../src/db/index.js';

describe('bootstrap', () => {
  it('seeds the household and admin idempotently', async () => {
    await bootstrap();
    await bootstrap(); // second run must not create a duplicate household or admin

    const household = createHouseholdService(db, createIdentityService(db));
    const h = await household.getHousehold();
    expect(h?.name).toBe('Test Household');

    const members = await household.listMembers();
    const admins = members.filter((m) => m.role === 'admin');
    expect(admins.length).toBe(1);
    expect(admins[0]!.email).toBe('admin@test.local');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/bootstrap.test.ts`
Expected: FAIL — `bootstrap` not exported.

- [ ] **Step 3: Write `src/modules/index.ts`**

```ts
import type { HeorthModule } from './registry.js';

// Modules are appended here as each phase lands (compile-time registration):
//   import { householdModule } from '../household/index.js';
//   import { calendarModule } from './calendar/index.js';
//   import { mealsModule } from './meals/index.js';
//   import { feohModule } from './feoh/index.js';
export const ALL_MODULES: HeorthModule[] = [
  // householdModule, calendarModule, mealsModule, feohModule
];
```

- [ ] **Step 4: Write `src/index.ts`**

```ts
import { serve } from '@hono/node-server';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createHouseholdService } from '@wyrhta/core/household';
import { createIdentityService } from '@wyrhta/core/identity';
import { createMcpServer } from '@wyrhta/core/mcp';
import { db } from './db/index.js';
import { config } from './config/env.js';
import { createApp, collectMcpTools } from './app.js';
import { ALL_MODULES } from './modules/index.js';

/** Migrate, seed the household+admin (idempotent), build the app + MCP server. */
export async function bootstrap() {
  await migrate(db, { migrationsFolder: './src/db/migrations' });

  const identity = createIdentityService(db);
  const household = createHouseholdService(db, identity);
  await household.seedHousehold({
    name: config.householdName,
    adminEmail: config.adminEmail,
    adminPassword: config.adminPassword,
    adminDisplayName: 'Admin',
  });

  const app = createApp(ALL_MODULES);

  const tools = collectMcpTools(ALL_MODULES).all();
  const mcpServer = createMcpServer(tools, async (rawKey) => {
    const result = await identity.validateApiKey(rawKey);
    if (!result) return null;
    return { userId: result.user.id, role: result.user.role };
  });

  return { app, mcpServer };
}

async function main() {
  console.log('Booting Heorth: migrations, household seed, module registration...');
  const { app, mcpServer } = await bootstrap();

  // Mount the MCP HTTP transport on the same server.
  app.all('/mcp', (c) => mcpServer.fetch(c.req.raw));

  serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`Heorth running on http://localhost:${info.port}`);
  });
}

// Only auto-run when executed directly (not when imported by tests).
if (process.env['VITEST'] === undefined) {
  main().catch((err) => {
    console.error('Fatal error during startup:', err);
    process.exit(1);
  });
}
```

- [ ] **Step 5: Generate & apply the initial migration, then run the test**

Run:
```bash
docker compose up -d db
npm run db:generate   # creates src/db/migrations/0000_*.sql (users, api_keys, household)
npm test -- tests/bootstrap.test.ts
```
Expected: migration file generated; test PASS (household seeded once, one admin after two boots).

- [ ] **Step 6: Commit**

```bash
git add src/index.ts src/modules/index.ts src/db/migrations
git commit -m "feat: add boot sequence (migrate, seed household, register modules, start REST + MCP)"
```

---


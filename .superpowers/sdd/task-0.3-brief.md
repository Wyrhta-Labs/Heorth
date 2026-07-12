### Task 0.3: DB client, schema aggregation & test harness

**Files:**
- Create: `src/db/index.ts`, `src/db/schema/index.ts`, `src/db/schema/drizzle-schema.ts`, `tests/setup.ts`

**Interfaces:**
- Consumes: `users`, `apiKeys`, `roleEnum` from `@wyrhta/core/identity`; `household` from `@wyrhta/core/household`; `config` from Task 0.2.
- Produces: `db` (Drizzle client), `DB` type. The schema barrel re-exports core tables + (later) module tables so drizzle-kit generates ONE migration set covering core and Heorth tables. `tests/setup.ts` migrates once and truncates per test.

- [ ] **Step 1: Write `src/db/schema/index.ts`** (ESM runtime, `.js` extensions)

```ts
// Runtime barrel (.js extensions). Re-exports @wyrhta/core tables so Heorth's
// single migration set covers identity + household + all module tables.
export { users, apiKeys, roleEnum } from '@wyrhta/core/identity';
export { household } from '@wyrhta/core/household';
// Module tables are appended here as each module lands:
// export * from './../../household/schema.js';  (Heorth-local, if any)
// export * from './../../modules/calendar/schema.js';
// export * from './../../modules/meals/schema.js';
// export * from './../../modules/feoh/schema.js';
```

- [ ] **Step 2: Write `src/db/schema/drizzle-schema.ts`** (drizzle-kit CJS, no `.js`)

```ts
// Used by drizzle-kit (CJS bundler): no .js extensions.
export { users, apiKeys, roleEnum } from '@wyrhta/core/identity';
export { household } from '@wyrhta/core/household';
// Module tables appended as each module lands (see schema/index.ts).
```

- [ ] **Step 3: Write `src/db/index.ts`**

```ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { config } from '../config/env.js';
import * as schema from './schema/index.js';

const queryClient = postgres(config.databaseUrl, { max: config.dbPoolMax });
export const db = drizzle(queryClient, { schema });

export type DB = typeof db;
```

- [ ] **Step 4: Write `tests/setup.ts`**

```ts
import { beforeAll, beforeEach } from 'vitest';

// Set required env BEFORE importing modules that read process.env at load time.
process.env['DATABASE_URL'] ??= 'postgres://heorth:changeme@localhost:5432/heorth';
process.env['JWT_SECRET'] ??= 'test-secret-test-secret-test-secret-123';
process.env['HOUSEHOLD_NAME'] ??= 'Test Household';
process.env['ADMIN_EMAIL'] ??= 'admin@test.local';
process.env['ADMIN_PASSWORD'] ??= 'test-admin-password';

const { migrate } = await import('drizzle-orm/postgres-js/migrator');
const { db } = await import('../src/db/index.js');
const { sql } = await import('drizzle-orm');

beforeAll(async () => {
  await migrate(db, { migrationsFolder: './src/db/migrations' });
});

beforeEach(async () => {
  // Truncate every application table, resetting FKs. Order-independent via CASCADE.
  await db.execute(sql`
    DO $$
    DECLARE r RECORD;
    BEGIN
      FOR r IN (
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename <> '__drizzle_migrations'
      ) LOOP
        EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' RESTART IDENTITY CASCADE';
      END LOOP;
    END $$;
  `);
});
```

- [ ] **Step 5: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS (no emit, no errors). (Migrations not generated yet; no test runs against DB in this task.)

- [ ] **Step 6: Commit**

```bash
git add src/db tests/setup.ts
git commit -m "feat: add Drizzle client, core-aware schema barrels, and test harness"
```

---


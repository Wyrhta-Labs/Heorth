### Task 0.2: Env validation

**Files:**
- Create: `src/config/env.ts`
- Test: `tests/env.test.ts`

**Interfaces:**
- Produces: `config` (const) with `databaseUrl`, `jwtSecret`, `householdName`, `adminEmail`, `adminPassword`, `port`, `jwtTtlSeconds`, `corsOrigin`, `dbPoolMax`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/env.test.ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Re-declare the schema shape under test by importing the builder.
// env.ts calls process.exit on failure, so we test the exported schema builder instead.
import { buildEnvSchema } from '../src/config/env.js';

describe('env schema', () => {
  const base = {
    DATABASE_URL: 'postgres://heorth:pw@localhost:5432/heorth',
    JWT_SECRET: 'x'.repeat(32),
    HOUSEHOLD_NAME: 'Our Home',
    ADMIN_EMAIL: 'admin@example.com',
    ADMIN_PASSWORD: 'secret',
  };

  it('accepts a valid environment', () => {
    const parsed = buildEnvSchema().safeParse(base);
    expect(parsed.success).toBe(true);
  });

  it('rejects a JWT_SECRET shorter than 32 chars', () => {
    const parsed = buildEnvSchema().safeParse({ ...base, JWT_SECRET: 'short' });
    expect(parsed.success).toBe(false);
  });

  it('rejects a missing HOUSEHOLD_NAME', () => {
    const { HOUSEHOLD_NAME, ...rest } = base;
    const parsed = buildEnvSchema().safeParse(rest);
    expect(parsed.success).toBe(false);
  });

  it('rejects an invalid ADMIN_EMAIL', () => {
    const parsed = buildEnvSchema().safeParse({ ...base, ADMIN_EMAIL: 'not-an-email' });
    expect(parsed.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/env.test.ts`
Expected: FAIL — `buildEnvSchema` not exported / module not found.

- [ ] **Step 3: Write `src/config/env.ts`**

```ts
import { z } from 'zod';

export function buildEnvSchema() {
  return z.object({
    DATABASE_URL: z.string().url(),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters for HS256 security'),
    HOUSEHOLD_NAME: z.string().min(1),
    ADMIN_EMAIL: z.string().email(),
    ADMIN_PASSWORD: z.string().min(1),
    API_PORT: z.coerce.number().int().positive().default(3000),
    JWT_TTL_SECONDS: z.coerce.number().int().positive().default(604800),
    CORS_ORIGIN: z.string().default('*'),
    DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  });
}

const parsed = buildEnvSchema().safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = {
  databaseUrl: parsed.data.DATABASE_URL,
  jwtSecret: parsed.data.JWT_SECRET,
  householdName: parsed.data.HOUSEHOLD_NAME,
  adminEmail: parsed.data.ADMIN_EMAIL,
  adminPassword: parsed.data.ADMIN_PASSWORD,
  port: parsed.data.API_PORT,
  jwtTtlSeconds: parsed.data.JWT_TTL_SECONDS,
  corsOrigin: parsed.data.CORS_ORIGIN,
  dbPoolMax: parsed.data.DB_POOL_MAX,
} as const;
```

> Note: `env.ts` runs `safeParse(process.env)` at import time and may `process.exit(1)`. `tests/setup.ts` (Task 0.3) sets the required env vars before any import, so importing `config` in tests is safe.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/env.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/config/env.ts tests/env.test.ts
git commit -m "feat: add Zod-validated env config extending core requirements"
```

---


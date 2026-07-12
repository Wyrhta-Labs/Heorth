# @wyrhta/core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the standalone `@wyrhta/core` npm package — identity/auth, optional household model, REST envelope, middleware, MCP scaffold, and DB conventions — extracted and generalized from KithLedger's proven code, consumed by KithLedger and Heorth via git-tag dependency.

**Architecture:** A `"type": "module"` TypeScript library with subpath exports (`@wyrhta/core/identity`, `/http`, `/auth`, `/mcp`, `/db`, `/household`, `/lib`, `/config`). Pure primitives are ported from KithLedger largely as-is (crypto, logger, pagination, response envelope, middleware). The identity layer is a *new* multi-user build (argon2id password hashing, `admin`/`adult`/`child` roles, JWT HS256, API keys) generalized from KithLedger's single-admin auth. Core owns **no domain concepts** — apps compose their own domains on top.

**Tech Stack:** Node.js 22, TypeScript 5.8, Hono 4, Drizzle ORM + postgres.js, PostgreSQL 16, Zod 3, argon2 (argon2id), `@modelcontextprotocol/sdk` 1.x, Vitest 3.

## Global Constraints

Every task's requirements implicitly include this section. Values copied verbatim from the specs.

- **`"type": "module"`** — ESM only. Runtime source imports use the **`.js` extension** even for `.ts` files (ESM runtime requirement).
- **Node.js 22 + TypeScript**, `moduleResolution: "bundler"`, `target`/`module`/`lib` `ES2022`, `strict: true`.
- **No domain concepts in core** — no people, recipes, or envelopes. Only generic primitives.
- **Drizzle timestamps:** `timestamp('col', { withTimezone: true })` — there is **no** `timestamptz` export.
- **Postgres UNIQUE violation = error code `23505`** — services catch it and surface `CONFLICT`.
- **`hono/jwt` `verify()` takes 3 args:** `verify(token, secret, 'HS256')`. Omitting the algorithm throws `JwtAlgorithmRequired`.
- **`JWT_SECRET` minimum 32 chars** — enforced at env validation (`z.string().min(32)`); shorter values exit the process at startup.
- **Response envelope:** `{ data, meta }` on success, `{ error: { code, message } }` on failure. Pagination `?limit&offset`, default limit 20, **max 100**.
- **Auth dispatch:** `Bearer <prefix>_…` → API-key path; `Bearer eyJ…` → JWT path. API-key prefix is **configurable per app** (`kl_`, `he_`). Key-management routes reject API-key auth (JWT only).
- **Roles:** `admin` | `adult` | `child` (Postgres enum `user_role`).
- **API keys:** raw key = `<prefix>` + 32-byte hex; stored as **SHA-256 hash** only; raw returned once at creation.
- **Migrations run programmatically at startup** via `migrate()` (in the consuming app, before `serve()`).
- **Consumption:** git-tag dependency (no registry pre-1.0). Package builds to `dist/` on `prepare`; subpath exports resolve to `dist/**`.
- **`drizzle-kit` runs via `tsx`;** schema barrels ship in two forms — `.js`-extension (ESM runtime) and no-extension (drizzle-kit CJS bundler).
- **Testing:** unit tests only in core (Vitest). DB-bound identity/household coverage happens in KithLedger/Heorth integration tests. Tests import source via relative `../src/**/*.js` paths (resolved to `.ts` by Vitest/esbuild), mirroring KithLedger.

**Pinned versions** (from KithLedger's proven set plus new deps):

| Package | Version |
|---|---|
| `hono` | `^4.7.4` |
| `drizzle-orm` | `^0.39.3` |
| `postgres` | `^3.4.5` |
| `zod` | `^3.24.2` |
| `argon2` | `^0.41.1` |
| `@modelcontextprotocol/sdk` | `^1.12.0` |
| `drizzle-kit` (dev) | `^0.30.4` |
| `tsx` (dev) | `^4.19.3` |
| `typescript` (dev) | `^5.8.2` |
| `vitest` (dev) | `^3.0.8` |
| `@types/node` (dev) | `^22.13.10` |

---

## File Structure

```
@wyrhta/core/
├── package.json                 # "type": "module"; subpath exports; prepare→build
├── tsconfig.json                # ES2022, bundler, strict, declaration, outDir dist
├── vitest.config.ts             # globals, node env (unit only — no setupFiles)
├── drizzle.config.ts            # schema → drizzle-schema.ts (no .js); out → migrations
├── .gitignore
├── src/
│   ├── index.ts                 # root barrel (version const)
│   ├── config/
│   │   ├── env.ts               # baseEnvSchema (JWT_SECRET min 32) + parseEnv
│   │   └── index.ts             # barrel
│   ├── lib/
│   │   ├── crypto.ts            # generateApiKey({ prefix }), hashKey
│   │   ├── logger.ts            # logEvent, logError
│   │   └── index.ts             # barrel
│   ├── http/
│   │   ├── envelope.ts          # Meta, ApiSuccess<T>, ApiError types
│   │   ├── response.ts          # ok(c, data, meta?, status?), err(c, code, msg, status?)
│   │   ├── pagination.ts        # parsePagination(query) → { limit, offset }
│   │   ├── middleware/
│   │   │   ├── request-id.ts    # requestId
│   │   │   ├── security-headers.ts # securityHeaders
│   │   │   ├── rate-limit.ts    # rateLimit({ windowMs, max })
│   │   │   └── error-handler.ts # errorHandler
│   │   └── index.ts             # barrel
│   ├── identity/
│   │   ├── schema.ts            # userRole enum, users, apiKeys tables + types
│   │   ├── password.ts          # hashPassword, verifyPassword (argon2id)
│   │   ├── jwt.ts               # signToken, verifyToken (HS256, 3-arg verify)
│   │   ├── api-key.ts           # generateKey(prefix), hashKey, validateApiKey(raw, lookup)
│   │   ├── service.ts           # createUser, authenticate, issueToken, keys CRUD
│   │   └── index.ts             # barrel
│   ├── auth/
│   │   ├── dispatch.ts          # detectAuthScheme(header, keyPrefix)
│   │   ├── guards.ts            # createAuthGuards → requireAuth/requireJwt/requireRole
│   │   └── index.ts             # barrel
│   ├── household/
│   │   ├── schema.ts            # household singleton table
│   │   ├── service.ts           # seedHousehold, listMembers, setRole
│   │   └── index.ts             # barrel
│   ├── mcp/
│   │   ├── types.ts             # McpTool, McpToolContext, McpPrincipal, AuthAdapter
│   │   ├── scaffold.ts          # createMcpServer(registry, authAdapter, info?)
│   │   └── index.ts             # barrel
│   └── db/
│       ├── client.ts            # createDb({ databaseUrl, schema, poolMax? })
│       ├── migrate.ts           # runMigrations(db, folder), coreMigrationsFolder()
│       ├── schema/
│       │   ├── index.ts         # .js re-exports (ESM runtime)
│       │   └── drizzle-schema.ts# no-.js re-exports (drizzle-kit CJS)
│       ├── migrations/          # generated SQL (identity + household)
│       └── index.ts             # barrel
└── tests/                       # unit tests mirror src/ layout
```

---

## Task 1: Package scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `src/index.ts`
- Test: `tests/smoke.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `CORE_VERSION: string` from `src/index.ts`. Build tooling (`npm run build`, `npm run typecheck`, `npm test`) and the subpath-export map that every later task's barrel plugs into.

- [ ] **Step 1: Write the failing test**

`tests/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { CORE_VERSION } from '../src/index.js';

describe('package scaffolding', () => {
  it('exposes a version string', () => {
    expect(typeof CORE_VERSION).toBe('string');
    expect(CORE_VERSION.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/smoke.test.ts`
Expected: FAIL — cannot resolve `../src/index.js` (module not found).

- [ ] **Step 3: Create `package.json`**

```json
{
  "name": "@wyrhta/core",
  "version": "0.1.0",
  "description": "Shared foundation for Wyrhta Labs services: identity, auth, HTTP kit, household, MCP scaffold, DB conventions",
  "type": "module",
  "files": ["dist"],
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
    "./config": { "types": "./dist/config/index.d.ts", "import": "./dist/config/index.js" },
    "./lib": { "types": "./dist/lib/index.d.ts", "import": "./dist/lib/index.js" },
    "./http": { "types": "./dist/http/index.d.ts", "import": "./dist/http/index.js" },
    "./identity": { "types": "./dist/identity/index.d.ts", "import": "./dist/identity/index.js" },
    "./auth": { "types": "./dist/auth/index.d.ts", "import": "./dist/auth/index.js" },
    "./household": { "types": "./dist/household/index.d.ts", "import": "./dist/household/index.js" },
    "./mcp": { "types": "./dist/mcp/index.d.ts", "import": "./dist/mcp/index.js" },
    "./db": { "types": "./dist/db/index.d.ts", "import": "./dist/db/index.js" }
  },
  "scripts": {
    "build": "tsc --project tsconfig.json",
    "typecheck": "tsc --noEmit",
    "prepare": "npm run build",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:generate": "tsx node_modules/drizzle-kit/bin.cjs generate",
    "db:migrate": "tsx node_modules/drizzle-kit/bin.cjs migrate",
    "db:push": "tsx node_modules/drizzle-kit/bin.cjs push",
    "db:studio": "tsx node_modules/drizzle-kit/bin.cjs studio"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0",
    "argon2": "^0.41.1",
    "drizzle-orm": "^0.39.3",
    "hono": "^4.7.4",
    "postgres": "^3.4.5",
    "zod": "^3.24.2"
  },
  "devDependencies": {
    "@types/node": "^22.13.10",
    "@vitest/coverage-v8": "^3.0.8",
    "drizzle-kit": "^0.30.4",
    "tsx": "^4.19.3",
    "typescript": "^5.8.2",
    "vitest": "^3.0.8"
  }
}
```

- [ ] **Step 4: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 5: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
});
```

- [ ] **Step 6: Create `.gitignore`**

```
node_modules
dist
*.log
.env
```

- [ ] **Step 7: Create `src/index.ts`**

```ts
export const CORE_VERSION = '0.1.0';
```

- [ ] **Step 8: Install dependencies**

Run: `npm install`
Expected: dependencies installed; `node_modules/` present; no error exit.

- [ ] **Step 9: Run the test to verify it passes**

Run: `npx vitest run tests/smoke.test.ts`
Expected: PASS — 1 passed.

- [ ] **Step 10: Verify typecheck**

Run: `npm run typecheck`
Expected: no output, exit code 0.

- [ ] **Step 11: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts .gitignore src/index.ts tests/smoke.test.ts
git commit -m "chore: scaffold @wyrhta/core package"
```

---

## Task 2: config/env base schema

**Files:**
- Create: `src/config/env.ts`
- Create: `src/config/index.ts`
- Test: `tests/config/env.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `baseEnvSchema` (Zod object with `DATABASE_URL`, `JWT_SECRET` min 32, `JWT_TTL_SECONDS`, `DB_POOL_MAX`, `CORS_ORIGIN`), `type BaseEnv`, and `parseEnv(extra?, source?) → parsed env` (calls `process.exit(1)` on failure). Apps extend `baseEnvSchema` for their own vars.

- [ ] **Step 1: Write the failing test**

`tests/config/env.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { baseEnvSchema, parseEnv } from '../../src/config/env.js';

const VALID = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  JWT_SECRET: 'x'.repeat(32),
};

describe('baseEnvSchema', () => {
  it('rejects a JWT_SECRET shorter than 32 chars', () => {
    const result = baseEnvSchema.safeParse({ ...VALID, JWT_SECRET: 'short' });
    expect(result.success).toBe(false);
  });

  it('rejects a non-URL DATABASE_URL', () => {
    const result = baseEnvSchema.safeParse({ ...VALID, DATABASE_URL: 'not-a-url' });
    expect(result.success).toBe(false);
  });

  it('applies defaults for optional vars', () => {
    const result = baseEnvSchema.safeParse(VALID);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.JWT_TTL_SECONDS).toBe(604800);
      expect(result.data.DB_POOL_MAX).toBe(10);
      expect(result.data.CORS_ORIGIN).toBe('*');
    }
  });

  it('parseEnv returns typed env from an injected source', () => {
    const env = parseEnv(undefined, VALID);
    expect(env.JWT_SECRET).toBe(VALID.JWT_SECRET);
  });

  it('parseEnv merges an extension schema', () => {
    const env = parseEnv({ API_PORT: undefined } as never, VALID);
    expect(env.DATABASE_URL).toBe(VALID.DATABASE_URL);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/config/env.test.ts`
Expected: FAIL — cannot resolve `../../src/config/env.js`.

- [ ] **Step 3: Write `src/config/env.ts`**

```ts
import { z } from 'zod';

export const baseEnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters for HS256 security'),
  JWT_TTL_SECONDS: z.coerce.number().int().positive().default(604800),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  CORS_ORIGIN: z.string().default('*'),
});

export type BaseEnv = z.infer<typeof baseEnvSchema>;

/**
 * Validate environment variables against the base schema, optionally extended
 * with app-specific fields. On failure prints field errors and exits the
 * process (startup guard). `source` defaults to `process.env`.
 */
export function parseEnv<T extends z.ZodRawShape>(
  extra?: T,
  source: Record<string, unknown> = process.env
): BaseEnv & (T extends z.ZodRawShape ? z.infer<z.ZodObject<T>> : unknown) {
  const schema = extra ? baseEnvSchema.extend(extra) : baseEnvSchema;
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    console.error('Invalid environment variables:');
    console.error(parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data as never;
}
```

- [ ] **Step 4: Write `src/config/index.ts`**

```ts
export * from './env.js';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/config/env.test.ts`
Expected: PASS — 5 passed.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/config tests/config
git commit -m "feat: add base env schema with JWT_SECRET min-32 guard"
```

---

## Task 3: lib/crypto — API key generation with configurable prefix

**Files:**
- Create: `src/lib/crypto.ts`
- Test: `tests/lib/crypto.test.ts`

**Interfaces:**
- Consumes: nothing (Node `crypto` builtin).
- Produces:
  - `generateApiKey({ prefix }: { prefix: string }) → { raw: string; hash: string; prefix: string }` — `raw` = `prefix` + 64 hex chars; `hash` = SHA-256 of `raw`; returned `prefix` = first `prefix.length + 8` chars of `raw` (display prefix).
  - `hashKey(raw: string) → string` — SHA-256 hex digest.

- [ ] **Step 1: Write the failing test**

`tests/lib/crypto.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { generateApiKey, hashKey } from '../../src/lib/crypto.js';

describe('generateApiKey', () => {
  it('produces a raw key that starts with the configured prefix', () => {
    const { raw } = generateApiKey({ prefix: 'kl_' });
    expect(raw.startsWith('kl_')).toBe(true);
  });

  it('produces 64 hex chars of entropy after the prefix', () => {
    const { raw } = generateApiKey({ prefix: 'he_' });
    const body = raw.slice('he_'.length);
    expect(body).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns a display prefix of prefix + 8 chars', () => {
    const { raw, prefix } = generateApiKey({ prefix: 'kl_' });
    expect(prefix).toBe(raw.slice(0, 'kl_'.length + 8));
    expect(prefix.length).toBe(11);
  });

  it('stores the SHA-256 hash of the raw key, not the raw key', () => {
    const { raw, hash } = generateApiKey({ prefix: 'kl_' });
    expect(hash).toBe(hashKey(raw));
    expect(hash).not.toBe(raw);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('generates unique keys on each call', () => {
    const a = generateApiKey({ prefix: 'kl_' });
    const b = generateApiKey({ prefix: 'kl_' });
    expect(a.raw).not.toBe(b.raw);
  });
});

describe('hashKey', () => {
  it('is deterministic for the same input', () => {
    expect(hashKey('kl_abc')).toBe(hashKey('kl_abc'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/crypto.test.ts`
Expected: FAIL — cannot resolve `../../src/lib/crypto.js`.

- [ ] **Step 3: Write `src/lib/crypto.ts`**

```ts
import { createHash, randomBytes } from 'crypto';

/**
 * Generate an API key with an app-configurable prefix (e.g. `kl_`, `he_`).
 * The raw key is `<prefix>` + 32 random bytes as hex. Only the SHA-256 hash is
 * ever persisted; `raw` is shown to the user exactly once at creation.
 */
export function generateApiKey({ prefix }: { prefix: string }): {
  raw: string;
  hash: string;
  prefix: string;
} {
  const bytes = randomBytes(32).toString('hex');
  const raw = `${prefix}${bytes}`;
  const hash = hashKey(raw);
  const displayPrefix = raw.slice(0, prefix.length + 8);
  return { raw, hash, prefix: displayPrefix };
}

export function hashKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/lib/crypto.test.ts`
Expected: PASS — 6 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/crypto.ts tests/lib/crypto.test.ts
git commit -m "feat: add api-key crypto with configurable prefix"
```

---

## Task 4: lib/logger + lib barrel

**Files:**
- Create: `src/lib/logger.ts`
- Create: `src/lib/index.ts`
- Test: `tests/lib/logger.test.ts`

**Interfaces:**
- Consumes: `generateApiKey`, `hashKey` (from Task 3, re-exported by barrel).
- Produces:
  - `interface LogEvent { timestamp?: string; event: string; [key: string]: unknown }`
  - `logEvent(event: LogEvent): void` — writes structured JSON to stdout, injecting `timestamp`.
  - `logError(message: string, error: unknown): void` — writes structured JSON to stderr with stack.
  - `src/lib/index.ts` barrel re-exporting `crypto.js` and `logger.js`.

- [ ] **Step 1: Write the failing test**

`tests/lib/logger.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { logEvent, logError } from '../../src/lib/logger.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('logEvent', () => {
  it('writes JSON to stdout with an injected timestamp and the event name', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logEvent({ event: 'auth.token.success', success: true });
    expect(spy).toHaveBeenCalledOnce();
    const payload = JSON.parse(spy.mock.calls[0]![0] as string);
    expect(payload.event).toBe('auth.token.success');
    expect(payload.success).toBe(true);
    expect(typeof payload.timestamp).toBe('string');
  });
});

describe('logError', () => {
  it('writes JSON to stderr with level=error and the message', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logError('boom', new Error('kaboom'));
    const payload = JSON.parse(spy.mock.calls[0]![0] as string);
    expect(payload.level).toBe('error');
    expect(payload.message).toBe('boom');
    expect(typeof payload.stack).toBe('string');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/logger.test.ts`
Expected: FAIL — cannot resolve `../../src/lib/logger.js`.

- [ ] **Step 3: Write `src/lib/logger.ts`**

```ts
export interface LogEvent {
  timestamp?: string;
  event: string;
  ip?: string;
  auth_type?: string;
  success?: boolean;
  request_id?: string;
  user_id?: string;
  key_id?: string;
  key_name?: string;
  [key: string]: unknown;
}

export function logEvent(event: LogEvent): void {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), ...event }));
}

export function logError(message: string, error: unknown): void {
  const stack = error instanceof Error ? error.stack : undefined;
  console.error(
    JSON.stringify({ timestamp: new Date().toISOString(), level: 'error', message, stack })
  );
}
```

- [ ] **Step 4: Write `src/lib/index.ts`**

```ts
export * from './crypto.js';
export * from './logger.js';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/lib/logger.test.ts`
Expected: PASS — 2 passed.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/lib/logger.ts src/lib/index.ts tests/lib/logger.test.ts
git commit -m "feat: add structured logger and lib barrel"
```

---

## Task 5: http/ envelope, response, pagination

**Files:**
- Create: `src/http/envelope.ts`
- Create: `src/http/response.ts`
- Create: `src/http/pagination.ts`
- Test: `tests/http/response.test.ts`
- Test: `tests/http/pagination.test.ts`

**Interfaces:**
- Consumes: `hono` `Context` type.
- Produces:
  - `interface Meta { total?: number; limit?: number; offset?: number; [k: string]: unknown }`
  - `interface ApiSuccess<T> { data: T; meta: Meta }`; `interface ApiError { error: { code: string; message: string; details?: unknown } }`
  - `ok<T>(c, data, meta?, status: 200 | 201 = 200)` → `c.json({ data, meta: meta ?? {} }, status)`
  - `err(c, code, message, status: 400 | 401 | 403 | 404 | 409 | 429 | 500 = 500)` → `c.json({ error: { code, message } }, status)`
  - `parsePagination(query: Record<string, string | undefined>) → { limit: number; offset: number }` — default limit 20, max 100, min 1, offset ≥ 0.

- [ ] **Step 1: Write the failing tests**

`tests/http/response.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { ok, err } from '../../src/http/response.js';

function makeApp() {
  const app = new Hono();
  app.get('/ok', (c) => ok(c, { hello: 'world' }, { total: 1 }));
  app.get('/created', (c) => ok(c, { id: 1 }, undefined, 201));
  app.get('/err', (c) => err(c, 'NOT_FOUND', 'missing', 404));
  return app;
}

describe('response envelope', () => {
  it('wraps success payloads in { data, meta }', async () => {
    const res = await makeApp().request('/ok');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { hello: 'world' }, meta: { total: 1 } });
  });

  it('defaults meta to {} and supports a 201 status', async () => {
    const res = await makeApp().request('/created');
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ data: { id: 1 }, meta: {} });
  });

  it('wraps failures in { error: { code, message } }', async () => {
    const res = await makeApp().request('/err');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'missing' } });
  });
});
```

`tests/http/pagination.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parsePagination } from '../../src/http/pagination.js';

describe('parsePagination', () => {
  it('applies defaults when absent', () => {
    expect(parsePagination({})).toEqual({ limit: 20, offset: 0 });
  });

  it('clamps limit to a max of 100', () => {
    expect(parsePagination({ limit: '500' }).limit).toBe(100);
  });

  it('clamps limit to a min of 1', () => {
    expect(parsePagination({ limit: '0' }).limit).toBe(1);
  });

  it('parses offset and floors it at 0', () => {
    expect(parsePagination({ offset: '40' }).offset).toBe(40);
    expect(parsePagination({ offset: '-5' }).offset).toBe(0);
  });

  it('falls back to defaults on non-numeric input', () => {
    expect(parsePagination({ limit: 'abc', offset: 'xyz' })).toEqual({ limit: 20, offset: 0 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/http/response.test.ts tests/http/pagination.test.ts`
Expected: FAIL — cannot resolve `../../src/http/response.js` / `pagination.js`.

- [ ] **Step 3: Write `src/http/envelope.ts`**

```ts
export interface Meta {
  total?: number;
  limit?: number;
  offset?: number;
  [key: string]: unknown;
}

export interface ApiSuccess<T> {
  data: T;
  meta: Meta;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
```

- [ ] **Step 4: Write `src/http/response.ts`**

```ts
import type { Context } from 'hono';
import type { Meta } from './envelope.js';

export function ok<T>(c: Context, data: T, meta?: Meta, status: 200 | 201 = 200) {
  return c.json({ data, meta: meta ?? {} }, status);
}

export function err(
  c: Context,
  code: string,
  message: string,
  status: 400 | 401 | 403 | 404 | 409 | 429 | 500 = 500
) {
  return c.json({ error: { code, message } }, status);
}
```

- [ ] **Step 5: Write `src/http/pagination.ts`**

```ts
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export interface Pagination {
  limit: number;
  offset: number;
}

export function parsePagination(query: Record<string, string | undefined>): Pagination {
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, parseInt(query['limit'] ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT)
  );
  const offset = Math.max(0, parseInt(query['offset'] ?? '0', 10) || 0);
  return { limit, offset };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/http/response.test.ts tests/http/pagination.test.ts`
Expected: PASS — 8 passed.

- [ ] **Step 7: Commit**

```bash
git add src/http/envelope.ts src/http/response.ts src/http/pagination.ts tests/http
git commit -m "feat: add http response envelope and pagination"
```

---

## Task 6: http/middleware + http barrel

**Files:**
- Create: `src/http/middleware/request-id.ts`
- Create: `src/http/middleware/security-headers.ts`
- Create: `src/http/middleware/rate-limit.ts`
- Create: `src/http/middleware/error-handler.ts`
- Create: `src/http/index.ts`
- Test: `tests/http/middleware.test.ts`

**Interfaces:**
- Consumes: `err` (Task 5), `logError` (Task 4), `hono` `MiddlewareHandler`/`ErrorHandler`, `zod` `ZodError`.
- Produces:
  - `requestId: MiddlewareHandler` — reads/sets `X-Request-Id`; sets `c.set('requestId', id)`. Augments Hono `ContextVariableMap` with `requestId: string`.
  - `securityHeaders: MiddlewareHandler` — sets `X-Content-Type-Options`, `X-Frame-Options`, `X-XSS-Protection: 0`, `Referrer-Policy`, `Permissions-Policy`; HSTS for non-localhost.
  - `rateLimit(options?: { windowMs?: number; max?: number }): MiddlewareHandler` — in-memory per-IP limiter; defaults `windowMs: 15*60*1000`, `max: 10`; returns 429 with `Retry-After`.
  - `errorHandler: ErrorHandler` — ZodError → 400 `VALIDATION_ERROR`; else 500 `INTERNAL_ERROR`.
  - `src/http/index.ts` barrel re-exporting envelope, response, pagination, and all middleware.

- [ ] **Step 1: Write the failing test**

`tests/http/middleware.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { ZodError, z } from 'zod';
import { requestId } from '../../src/http/middleware/request-id.js';
import { securityHeaders } from '../../src/http/middleware/security-headers.js';
import { rateLimit } from '../../src/http/middleware/rate-limit.js';
import { errorHandler } from '../../src/http/middleware/error-handler.js';

describe('requestId', () => {
  it('echoes an incoming X-Request-Id and exposes it on the context', async () => {
    const app = new Hono();
    app.use('*', requestId);
    app.get('/', (c) => c.text(c.get('requestId')));
    const res = await app.request('/', { headers: { 'x-request-id': 'abc-123' } });
    expect(res.headers.get('X-Request-Id')).toBe('abc-123');
    expect(await res.text()).toBe('abc-123');
  });

  it('generates a request id when none is supplied', async () => {
    const app = new Hono();
    app.use('*', requestId);
    app.get('/', (c) => c.text('ok'));
    const res = await app.request('/');
    expect(res.headers.get('X-Request-Id')).toMatch(/[0-9a-f-]{36}/);
  });
});

describe('securityHeaders', () => {
  it('sets hardening headers', async () => {
    const app = new Hono();
    app.use('*', securityHeaders);
    app.get('/', (c) => c.text('ok'));
    const res = await app.request('/');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('X-XSS-Protection')).toBe('0');
  });
});

describe('rateLimit', () => {
  it('returns 429 after the max is exceeded for an IP', async () => {
    const app = new Hono();
    app.use('*', rateLimit({ windowMs: 60_000, max: 2 }));
    app.get('/', (c) => c.text('ok'));
    const headers = { 'x-forwarded-for': '10.0.0.1' };
    expect((await app.request('/', { headers })).status).toBe(200);
    expect((await app.request('/', { headers })).status).toBe(200);
    const third = await app.request('/', { headers });
    expect(third.status).toBe(429);
    expect(third.headers.get('Retry-After')).not.toBeNull();
  });
});

describe('errorHandler', () => {
  it('maps ZodError to a 400 VALIDATION_ERROR', async () => {
    const app = new Hono();
    app.onError(errorHandler);
    app.get('/', () => {
      z.object({ x: z.number() }).parse({ x: 'nope' });
      return new Response();
    });
    const res = await app.request('/');
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
  });

  it('maps unknown errors to a 500 INTERNAL_ERROR', async () => {
    const app = new Hono();
    app.onError(errorHandler);
    app.get('/', () => {
      throw new Error('boom');
    });
    const res = await app.request('/');
    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe('INTERNAL_ERROR');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/http/middleware.test.ts`
Expected: FAIL — cannot resolve the middleware modules.

- [ ] **Step 3: Write `src/http/middleware/request-id.ts`**

```ts
import type { MiddlewareHandler } from 'hono';

declare module 'hono' {
  interface ContextVariableMap {
    requestId: string;
  }
}

export const requestId: MiddlewareHandler = async (c, next) => {
  const id = c.req.header('x-request-id') ?? crypto.randomUUID();
  c.set('requestId', id);
  c.header('X-Request-Id', id);
  await next();
};
```

- [ ] **Step 4: Write `src/http/middleware/security-headers.ts`**

```ts
import type { MiddlewareHandler } from 'hono';

export const securityHeaders: MiddlewareHandler = async (c, next) => {
  await next();

  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  // Explicitly disable the legacy XSS auditor — modern browsers ignore it and
  // some versions introduced vulnerabilities when it was enabled.
  c.header('X-XSS-Protection', '0');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  const host = c.req.header('host') ?? '';
  if (!host.includes('localhost') && !host.includes('127.0.0.1')) {
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  c.res.headers.delete('X-Powered-By');
};
```

- [ ] **Step 5: Write `src/http/middleware/rate-limit.ts`**

```ts
import type { MiddlewareHandler } from 'hono';

interface RateEntry {
  count: number;
  resetAt: number;
}

function getIp(c: Parameters<MiddlewareHandler>[0]): string {
  return (
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    c.req.header('cf-connecting-ip') ??
    'unknown'
  );
}

/**
 * In-memory, per-IP fixed-window rate limiter. Defaults: 10 requests / 15 min.
 * Each call to `rateLimit` gets its own isolated store, so different routes
 * (e.g. `/auth/token`) can have independent budgets.
 */
export function rateLimit(
  options: { windowMs?: number; max?: number } = {}
): MiddlewareHandler {
  const windowMs = options.windowMs ?? 15 * 60 * 1000;
  const max = options.max ?? 10;
  const store = new Map<string, RateEntry>();

  return async (c, next) => {
    const ip = getIp(c);
    const now = Date.now();

    const entry = store.get(ip);
    if (!entry || entry.resetAt < now) {
      store.set(ip, { count: 1, resetAt: now + windowMs });
      return next();
    }

    entry.count++;

    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      c.header('Retry-After', String(retryAfter));
      return c.json(
        { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please try again later.' } },
        429
      );
    }

    return next();
  };
}
```

- [ ] **Step 6: Write `src/http/middleware/error-handler.ts`**

```ts
import type { ErrorHandler } from 'hono';
import { ZodError } from 'zod';
import { logError } from '../../lib/logger.js';

export const errorHandler: ErrorHandler = (error, c) => {
  if (error instanceof ZodError) {
    // In production omit field-level details to avoid leaking schema info.
    const details =
      process.env['NODE_ENV'] !== 'production' ? error.flatten().fieldErrors : undefined;
    return c.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          ...(details ? { details } : {}),
        },
      },
      400
    );
  }

  logError('Unhandled error', error);
  return c.json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } }, 500);
};
```

- [ ] **Step 7: Write `src/http/index.ts`**

```ts
export * from './envelope.js';
export * from './response.js';
export * from './pagination.js';
export * from './middleware/request-id.js';
export * from './middleware/security-headers.js';
export * from './middleware/rate-limit.js';
export * from './middleware/error-handler.js';
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx vitest run tests/http/middleware.test.ts`
Expected: PASS — 7 passed.

- [ ] **Step 9: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 10: Commit**

```bash
git add src/http/middleware src/http/index.ts tests/http/middleware.test.ts
git commit -m "feat: add http middleware stack and http barrel"
```

---

## Task 7: db/client factory + migration runner

**Files:**
- Create: `src/db/client.ts`
- Create: `src/db/migrate.ts`
- Create: `src/db/index.ts`
- Test: `tests/db/client.test.ts`

**Interfaces:**
- Consumes: `drizzle-orm/postgres-js`, `postgres`.
- Produces:
  - `createDb<TSchema extends Record<string, unknown>>({ databaseUrl, schema, poolMax? }) → PostgresJsDatabase<TSchema>` — postgres.js connects lazily, so this never touches the network until a query runs.
  - `type CoreDb = PostgresJsDatabase<Record<string, unknown>>`
  - `runMigrations(db: CoreDb, migrationsFolder: string) → Promise<void>`
  - `coreMigrationsFolder() → string` — absolute path to core's own `dist|src/db/migrations` (for apps that want to run core's identity/household migrations).
  - `src/db/index.ts` barrel re-exporting client + migrate.

- [ ] **Step 1: Write the failing test**

`tests/db/client.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { createDb, runMigrations, coreMigrationsFolder } from '../../src/db/index.js';

describe('createDb', () => {
  it('returns a drizzle client without connecting (lazy)', () => {
    const db = createDb({
      databaseUrl: 'postgres://u:p@localhost:5432/db',
      schema: {},
    });
    expect(db).toBeDefined();
    expect(typeof db.select).toBe('function');
  });
});

describe('runMigrations', () => {
  it('is a function', () => {
    expect(typeof runMigrations).toBe('function');
  });
});

describe('coreMigrationsFolder', () => {
  it('returns a string path ending in db/migrations', () => {
    expect(coreMigrationsFolder().replace(/\\/g, '/')).toMatch(/db\/migrations$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/db/client.test.ts`
Expected: FAIL — cannot resolve `../../src/db/index.js`.

- [ ] **Step 3: Write `src/db/client.ts`**

```ts
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

export type CoreDb = PostgresJsDatabase<Record<string, unknown>>;

export interface CreateDbOptions<TSchema extends Record<string, unknown>> {
  databaseUrl: string;
  schema: TSchema;
  poolMax?: number;
}

/**
 * Build a Drizzle client over postgres.js. Connection is lazy — nothing hits
 * the network until the first query, so this is safe to construct at import
 * time and in unit tests.
 */
export function createDb<TSchema extends Record<string, unknown>>(
  options: CreateDbOptions<TSchema>
): PostgresJsDatabase<TSchema> {
  const client = postgres(options.databaseUrl, { max: options.poolMax ?? 10 });
  return drizzle(client, { schema: options.schema });
}
```

- [ ] **Step 4: Write `src/db/migrate.ts`**

```ts
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type { CoreDb } from './client.js';

/** Run migrations from the given folder against the given Drizzle client. */
export async function runMigrations(db: CoreDb, migrationsFolder: string): Promise<void> {
  await migrate(db, { migrationsFolder });
}

/**
 * Absolute path to core's own migration SQL (identity + household). Apps can
 * run these before their own migrations:
 *   await runMigrations(db, coreMigrationsFolder());
 */
export function coreMigrationsFolder(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, 'migrations');
}
```

- [ ] **Step 5: Write `src/db/index.ts`**

```ts
export * from './client.js';
export * from './migrate.js';
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/db/client.test.ts`
Expected: PASS — 3 passed.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/db/client.ts src/db/migrate.ts src/db/index.ts tests/db/client.test.ts
git commit -m "feat: add db client factory and migration runner"
```

---

## Task 8: identity/schema — users, api_keys, role enum

**Files:**
- Create: `src/identity/schema.ts`
- Test: `tests/identity/schema.test.ts`

**Interfaces:**
- Consumes: `drizzle-orm/pg-core`, `drizzle-orm` `sql`.
- Produces:
  - `userRole = pgEnum('user_role', ['admin', 'adult', 'child'])`
  - `type Role = 'admin' | 'adult' | 'child'`
  - `users` table: `id` (uuid pk), `email` (unique), `handle` (unique), `passwordHash` (`password_hash`), `role` (default `'adult'`), `displayName` (`display_name`, nullable), `avatarColor` (`avatar_color`, nullable), `createdAt`, `updatedAt`.
  - `apiKeys` table: `id` (uuid pk), `userId` (`user_id`, FK → users, cascade), `name`, `keyHash` (`key_hash`, unique), `prefix`, `lastUsedAt` (`last_used_at`, nullable), `createdAt`.
  - `type User = typeof users.$inferSelect`, `type NewUser`, `type ApiKey`, `type NewApiKey`.

- [ ] **Step 1: Write the failing test**

`tests/identity/schema.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { users, apiKeys, userRole } from '../../src/identity/schema.js';

describe('identity schema', () => {
  it('defines the user_role enum with admin/adult/child', () => {
    expect([...userRole.enumValues]).toEqual(['admin', 'adult', 'child']);
  });

  it('maps users to the expected columns', () => {
    const cols = Object.keys(users);
    expect(cols).toEqual(
      expect.arrayContaining([
        'id',
        'email',
        'handle',
        'passwordHash',
        'role',
        'displayName',
        'avatarColor',
        'createdAt',
        'updatedAt',
      ])
    );
  });

  it('maps api_keys to the expected columns', () => {
    const cols = Object.keys(apiKeys);
    expect(cols).toEqual(
      expect.arrayContaining(['id', 'userId', 'name', 'keyHash', 'prefix', 'lastUsedAt', 'createdAt'])
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/identity/schema.test.ts`
Expected: FAIL — cannot resolve `../../src/identity/schema.js`.

- [ ] **Step 3: Write `src/identity/schema.ts`**

```ts
import { pgTable, pgEnum, text, uuid, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const userRole = pgEnum('user_role', ['admin', 'adult', 'child']);
export type Role = (typeof userRole.enumValues)[number];

export const users = pgTable('users', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  email: text('email').notNull().unique(),
  handle: text('handle').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: userRole('role').notNull().default('adult'),
  displayName: text('display_name'),
  avatarColor: text('avatar_color'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
});

export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  keyHash: text('key_hash').notNull().unique(),
  prefix: text('prefix').notNull(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/identity/schema.test.ts`
Expected: PASS — 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/identity/schema.ts tests/identity/schema.test.ts
git commit -m "feat: add identity schema (users, api_keys, role enum)"
```

---

## Task 9: identity/password — argon2id hash/verify

**Files:**
- Create: `src/identity/password.ts`
- Test: `tests/identity/password.test.ts`

**Interfaces:**
- Consumes: `argon2`.
- Produces:
  - `hashPassword(plain: string) → Promise<string>` — argon2id encoded hash.
  - `verifyPassword(hash: string, plain: string) → Promise<boolean>` — returns `false` (never throws) on mismatch or malformed hash.

- [ ] **Step 1: Write the failing test**

`tests/identity/password.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/identity/password.js';

describe('password hashing', () => {
  it('produces an argon2id hash that verifies against the original', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(hash, 'correct horse battery staple')).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('s3cret');
    expect(await verifyPassword(hash, 'wrong')).toBe(false);
  });

  it('returns false (does not throw) on a malformed hash', async () => {
    expect(await verifyPassword('not-a-hash', 'whatever')).toBe(false);
  });

  it('salts — two hashes of the same password differ', async () => {
    const a = await hashPassword('same');
    const b = await hashPassword('same');
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/identity/password.test.ts`
Expected: FAIL — cannot resolve `../../src/identity/password.js`.

- [ ] **Step 3: Write `src/identity/password.ts`**

```ts
import argon2 from 'argon2';

/** Hash a plaintext password with argon2id (the recommended variant). */
export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

/** Verify a plaintext password against an argon2id hash. Never throws. */
export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/identity/password.test.ts`
Expected: PASS — 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/identity/password.ts tests/identity/password.test.ts
git commit -m "feat: add argon2id password hashing"
```

---

## Task 10: identity/jwt — sign/verify HS256

**Files:**
- Create: `src/identity/jwt.ts`
- Test: `tests/identity/jwt.test.ts`

**Interfaces:**
- Consumes: `hono/jwt` (`sign`, `verify`), `Role` (Task 8).
- Produces:
  - `interface TokenClaims { sub: string; role: Role; iat?: number; exp?: number }`
  - `signToken(claims: { sub: string; role: Role }, secret: string, ttlSeconds: number) → Promise<string>` — sets `iat`/`exp`; HS256.
  - `verifyToken(token: string, secret: string, algorithm: 'HS256' = 'HS256') → Promise<TokenClaims>` — calls `verify(token, secret, algorithm)` (the required 3rd arg); throws on invalid/expired token or missing `sub`.

- [ ] **Step 1: Write the failing test**

`tests/identity/jwt.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { signToken, verifyToken } from '../../src/identity/jwt.js';

const SECRET = 'x'.repeat(32);

describe('jwt', () => {
  it('round-trips sub and role through sign/verify', async () => {
    const token = await signToken({ sub: 'user-1', role: 'admin' }, SECRET, 3600);
    const claims = await verifyToken(token, SECRET);
    expect(claims.sub).toBe('user-1');
    expect(claims.role).toBe('admin');
    expect(typeof claims.exp).toBe('number');
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await signToken({ sub: 'u', role: 'adult' }, SECRET, 3600);
    await expect(verifyToken(token, 'y'.repeat(32))).rejects.toThrow();
  });

  it('rejects an expired token', async () => {
    const token = await signToken({ sub: 'u', role: 'adult' }, SECRET, -1);
    await expect(verifyToken(token, SECRET)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/identity/jwt.test.ts`
Expected: FAIL — cannot resolve `../../src/identity/jwt.js`.

- [ ] **Step 3: Write `src/identity/jwt.ts`**

```ts
import { sign, verify } from 'hono/jwt';
import type { Role } from './schema.js';

export interface TokenClaims {
  sub: string;
  role: Role;
  iat?: number;
  exp?: number;
}

/** Sign an HS256 JWT carrying the user id (`sub`) and `role`. */
export async function signToken(
  claims: { sub: string; role: Role },
  secret: string,
  ttlSeconds: number
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload = { sub: claims.sub, role: claims.role, iat: now, exp: now + ttlSeconds };
  return sign(payload, secret);
}

/**
 * Verify an HS256 JWT. `hono/jwt`'s `verify` REQUIRES the algorithm as its 3rd
 * argument — omitting it throws `JwtAlgorithmRequired`. `verify` also throws on
 * an expired token (`JwtTokenExpired`).
 */
export async function verifyToken(
  token: string,
  secret: string,
  algorithm: 'HS256' = 'HS256'
): Promise<TokenClaims> {
  const payload = await verify(token, secret, algorithm);
  if (!payload.sub || typeof payload.sub !== 'string') {
    throw new Error('INVALID_TOKEN');
  }
  return payload as unknown as TokenClaims;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/identity/jwt.test.ts`
Expected: PASS — 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/identity/jwt.ts tests/identity/jwt.test.ts
git commit -m "feat: add HS256 jwt sign/verify"
```

---

## Task 11: identity/api-key — generate + validate

**Files:**
- Create: `src/identity/api-key.ts`
- Test: `tests/identity/api-key.test.ts`

**Interfaces:**
- Consumes: `generateApiKey`, `hashKey` (Task 3).
- Produces:
  - `generateKey(prefix: string) → { raw: string; hash: string; prefix: string }` — thin wrapper over `generateApiKey({ prefix })`.
  - re-export `hashKey`.
  - `validateApiKey<T extends { keyHash: string }>(raw: string, lookup: (hash: string) => Promise<T | null>) → Promise<T | null>` — hashes `raw`, delegates the DB lookup to the injected `lookup` (keeps core DB-agnostic and unit-testable).

- [ ] **Step 1: Write the failing test**

`tests/identity/api-key.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { generateKey, validateApiKey, hashKey } from '../../src/identity/api-key.js';

describe('generateKey', () => {
  it('delegates to crypto with the configured prefix', () => {
    const { raw, hash, prefix } = generateKey('he_');
    expect(raw.startsWith('he_')).toBe(true);
    expect(hash).toBe(hashKey(raw));
    expect(prefix.length).toBe('he_'.length + 8);
  });
});

describe('validateApiKey', () => {
  it('looks up by the SHA-256 hash of the raw key and returns the record', async () => {
    const record = { keyHash: '', userId: 'u1' };
    const { raw, hash } = generateKey('kl_');
    record.keyHash = hash;
    const lookup = vi.fn(async (h: string) => (h === hash ? record : null));
    const found = await validateApiKey(raw, lookup);
    expect(lookup).toHaveBeenCalledWith(hash);
    expect(found).toBe(record);
  });

  it('returns null when the lookup finds nothing', async () => {
    const found = await validateApiKey('kl_deadbeef', async () => null);
    expect(found).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/identity/api-key.test.ts`
Expected: FAIL — cannot resolve `../../src/identity/api-key.js`.

- [ ] **Step 3: Write `src/identity/api-key.ts`**

```ts
import { generateApiKey, hashKey } from '../lib/crypto.js';

export { hashKey };

export interface GeneratedKey {
  raw: string;
  hash: string;
  prefix: string;
}

/** Generate a new API key for the app's configured prefix (e.g. `kl_`, `he_`). */
export function generateKey(prefix: string): GeneratedKey {
  return generateApiKey({ prefix });
}

/**
 * Validate a raw API key by hashing it and delegating the record lookup to the
 * caller. Core stays DB-agnostic: apps pass a `lookup` closure over their
 * Drizzle client (e.g. `hash => db.select()...where(eq(apiKeys.keyHash, hash))`).
 */
export async function validateApiKey<T extends { keyHash: string }>(
  raw: string,
  lookup: (hash: string) => Promise<T | null>
): Promise<T | null> {
  const hash = hashKey(raw);
  return lookup(hash);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/identity/api-key.test.ts`
Expected: PASS — 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/identity/api-key.ts tests/identity/api-key.test.ts
git commit -m "feat: add api-key generate and validate helpers"
```

---

## Task 12: identity/service — users + tokens + keys CRUD

**Files:**
- Create: `src/identity/service.ts`
- Create: `src/identity/index.ts`
- Test: `tests/identity/service.test.ts`

**Interfaces:**
- Consumes: `users`, `apiKeys`, `Role`, `User` (Task 8); `hashPassword`, `verifyPassword` (Task 9); `signToken` (Task 10); `generateKey` (Task 11); `CoreDb` (Task 7); `drizzle-orm` `eq`/`and`.
- Produces:
  - `type PublicUser = Omit<User, 'passwordHash'>`
  - `interface CreateUserInput { email; handle; password; role?; displayName?; avatarColor? }`
  - `isUniqueViolation(error: unknown) → boolean` — true for Postgres code `23505`.
  - `createUser(db, input) → Promise<PublicUser>` — hashes password, inserts, maps `23505` → `throw new Error('CONFLICT')`.
  - `authenticate(db, email, password) → Promise<PublicUser | null>`
  - `issueToken(user: { id: string; role: Role }, secret, ttlSeconds) → Promise<{ token: string; expiresIn: number }>`
  - `createApiKey(db, userId, name, prefix) → Promise<{ id; name; prefix; createdAt; key }>` — `key` (raw) returned once.
  - `listApiKeys(db, userId) → Promise<Array<{ id; name; prefix; lastUsedAt; createdAt }>>`
  - `revokeApiKey(db, userId, keyId) → Promise<boolean>`
  - `src/identity/index.ts` barrel re-exporting schema, password, jwt, api-key, service.

> **Testing note:** DB-touching paths (`authenticate`, `listApiKeys`, `createApiKey` insert, `revokeApiKey`) are exercised end-to-end by KithLedger/Heorth integration tests (per the spec's Testing section). Unit tests here cover the pure logic (`issueToken`), the error mapping (`isUniqueViolation`, `createUser` → `CONFLICT`), and `createUser`'s public-user shaping — all via a minimal stub `db`.

- [ ] **Step 1: Write the failing test**

`tests/identity/service.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  isUniqueViolation,
  issueToken,
  createUser,
  type CreateUserInput,
} from '../../src/identity/service.js';
import { verifyToken } from '../../src/identity/jwt.js';
import type { CoreDb } from '../../src/db/client.js';

const SECRET = 'x'.repeat(32);

describe('isUniqueViolation', () => {
  it('recognises Postgres error code 23505', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
    expect(isUniqueViolation({ code: '23503' })).toBe(false);
    expect(isUniqueViolation(new Error('nope'))).toBe(false);
  });
});

describe('issueToken', () => {
  it('signs a verifiable JWT carrying id and role', async () => {
    const { token, expiresIn } = await issueToken({ id: 'u1', role: 'adult' }, SECRET, 3600);
    expect(expiresIn).toBe(3600);
    const claims = await verifyToken(token, SECRET);
    expect(claims.sub).toBe('u1');
    expect(claims.role).toBe('adult');
  });
});

describe('createUser', () => {
  const input: CreateUserInput = { email: 'a@b.co', handle: 'ab', password: 'pw1234567890' };

  it('inserts and returns a user without the password hash', async () => {
    const row = {
      id: 'u1',
      email: 'a@b.co',
      handle: 'ab',
      passwordHash: 'hashed',
      role: 'adult',
      displayName: null,
      avatarColor: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const db = {
      insert: () => ({ values: () => ({ returning: async () => [row] }) }),
    } as unknown as CoreDb;

    const user = await createUser(db, input);
    expect(user).not.toHaveProperty('passwordHash');
    expect(user.email).toBe('a@b.co');
  });

  it('maps a 23505 unique violation to a CONFLICT error', async () => {
    const db = {
      insert: () => ({
        values: () => ({
          returning: async () => {
            throw { code: '23505' };
          },
        }),
      }),
    } as unknown as CoreDb;

    await expect(createUser(db, input)).rejects.toThrow('CONFLICT');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/identity/service.test.ts`
Expected: FAIL — cannot resolve `../../src/identity/service.js`.

- [ ] **Step 3: Write `src/identity/service.ts`**

```ts
import { and, eq } from 'drizzle-orm';
import type { CoreDb } from '../db/client.js';
import { users, apiKeys, type Role, type User } from './schema.js';
import { hashPassword, verifyPassword } from './password.js';
import { signToken } from './jwt.js';
import { generateKey } from './api-key.js';

export type PublicUser = Omit<User, 'passwordHash'>;

export interface CreateUserInput {
  email: string;
  handle: string;
  password: string;
  role?: Role;
  displayName?: string | null;
  avatarColor?: string | null;
}

/** True for a Postgres UNIQUE constraint violation (code 23505). */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: string }).code === '23505'
  );
}

function toPublic(user: User): PublicUser {
  const { passwordHash: _passwordHash, ...rest } = user;
  return rest;
}

export async function createUser(db: CoreDb, input: CreateUserInput): Promise<PublicUser> {
  const passwordHash = await hashPassword(input.password);
  try {
    const [row] = await db
      .insert(users)
      .values({
        email: input.email,
        handle: input.handle,
        passwordHash,
        role: input.role ?? 'adult',
        displayName: input.displayName ?? null,
        avatarColor: input.avatarColor ?? null,
      })
      .returning();
    if (!row) throw new Error('Failed to create user');
    return toPublic(row);
  } catch (error: unknown) {
    if (isUniqueViolation(error)) throw new Error('CONFLICT');
    throw error;
  }
}

export async function authenticate(
  db: CoreDb,
  email: string,
  password: string
): Promise<PublicUser | null> {
  const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!row) return null;
  const valid = await verifyPassword(row.passwordHash, password);
  return valid ? toPublic(row) : null;
}

export async function issueToken(
  user: { id: string; role: Role },
  secret: string,
  ttlSeconds: number
): Promise<{ token: string; expiresIn: number }> {
  const token = await signToken({ sub: user.id, role: user.role }, secret, ttlSeconds);
  return { token, expiresIn: ttlSeconds };
}

export async function createApiKey(db: CoreDb, userId: string, name: string, prefix: string) {
  const { raw, hash, prefix: displayPrefix } = generateKey(prefix);
  const [row] = await db
    .insert(apiKeys)
    .values({ userId, name, keyHash: hash, prefix: displayPrefix })
    .returning();
  if (!row) throw new Error('Failed to create API key');
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    createdAt: row.createdAt,
    key: raw, // only time the raw key is returned
  };
}

export async function listApiKeys(db: CoreDb, userId: string) {
  return db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      prefix: apiKeys.prefix,
      lastUsedAt: apiKeys.lastUsedAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.userId, userId))
    .orderBy(apiKeys.createdAt);
}

export async function revokeApiKey(db: CoreDb, userId: string, keyId: string): Promise<boolean> {
  const [row] = await db
    .delete(apiKeys)
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId)))
    .returning();
  return !!row;
}
```

- [ ] **Step 4: Write `src/identity/index.ts`**

```ts
export * from './schema.js';
export * from './password.js';
export * from './jwt.js';
export * from './api-key.js';
export * from './service.js';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/identity/service.test.ts`
Expected: PASS — 4 passed.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/identity/service.ts src/identity/index.ts tests/identity/service.test.ts
git commit -m "feat: add identity service (users, tokens, keys crud)"
```

---

## Task 13: auth/dispatch — Bearer scheme detection

**Files:**
- Create: `src/auth/dispatch.ts`
- Test: `tests/auth/dispatch.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type AuthScheme = 'api_key' | 'jwt'`
  - `detectAuthScheme(authHeader: string | undefined, keyPrefix: string) → AuthScheme | null` — `Bearer <keyPrefix>…` → `'api_key'`; `Bearer eyJ…` → `'jwt'`; anything else → `null`.

- [ ] **Step 1: Write the failing test**

`tests/auth/dispatch.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { detectAuthScheme } from '../../src/auth/dispatch.js';

describe('detectAuthScheme', () => {
  it('routes a prefixed Bearer token to the api-key path', () => {
    expect(detectAuthScheme('Bearer kl_abcdef', 'kl_')).toBe('api_key');
    expect(detectAuthScheme('Bearer he_abcdef', 'he_')).toBe('api_key');
  });

  it('routes an eyJ Bearer token to the jwt path', () => {
    expect(detectAuthScheme('Bearer eyJhbGciOi.payload.sig', 'kl_')).toBe('jwt');
  });

  it('returns null for a missing or malformed header', () => {
    expect(detectAuthScheme(undefined, 'kl_')).toBeNull();
    expect(detectAuthScheme('Basic abc', 'kl_')).toBeNull();
    expect(detectAuthScheme('Bearer ', 'kl_')).toBeNull();
    expect(detectAuthScheme('Bearer mystery', 'kl_')).toBeNull();
  });

  it('does not treat a jwt as an api key when prefixes differ', () => {
    expect(detectAuthScheme('Bearer eyJabc', 'he_')).toBe('jwt');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/auth/dispatch.test.ts`
Expected: FAIL — cannot resolve `../../src/auth/dispatch.js`.

- [ ] **Step 3: Write `src/auth/dispatch.ts`**

```ts
export type AuthScheme = 'api_key' | 'jwt';

/**
 * Decide which auth path a `Authorization` header takes:
 *   `Bearer <keyPrefix>…` → 'api_key'
 *   `Bearer eyJ…`         → 'jwt'   (JWTs always start with the base64url of `{"alg"`)
 * Anything else → null (caller returns 401).
 */
export function detectAuthScheme(
  authHeader: string | undefined,
  keyPrefix: string
): AuthScheme | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  if (token.length === 0) return null;
  if (token.startsWith(keyPrefix)) return 'api_key';
  if (token.startsWith('eyJ')) return 'jwt';
  return null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/auth/dispatch.test.ts`
Expected: PASS — 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/auth/dispatch.ts tests/auth/dispatch.test.ts
git commit -m "feat: add bearer auth-scheme dispatch"
```

---

## Task 14: auth/guards — requireAuth, requireJwt, requireRole

**Files:**
- Create: `src/auth/guards.ts`
- Create: `src/auth/index.ts`
- Test: `tests/auth/guards.test.ts`

**Interfaces:**
- Consumes: `err` (Task 5); `verifyToken` (Task 10); `detectAuthScheme` (Task 13); `Role` (Task 8); `hono` `MiddlewareHandler`; `signToken` (Task 10, test only).
- Produces:
  - `interface Principal { type: 'api_key' | 'jwt'; userId: string; role: Role }` — set on `c.set('principal', …)`; augments Hono `ContextVariableMap` with `principal?: Principal`.
  - `interface AuthGuardDeps { jwtSecret: string; keyPrefix: string; resolveApiKey: (raw: string) => Promise<Principal | null> }`
  - `interface AuthGuards { requireAuth: MiddlewareHandler; requireJwt: MiddlewareHandler; requireRole: (...roles: Role[]) => MiddlewareHandler }`
  - `createAuthGuards(deps: AuthGuardDeps) → AuthGuards`.
  - `src/auth/index.ts` barrel re-exporting dispatch + guards.

> `resolveApiKey` is the app-provided bridge to identity: it validates a raw key (via `validateApiKey`), loads the owning user, and returns `{ type: 'api_key', userId, role }` or `null`.

- [ ] **Step 1: Write the failing test**

`tests/auth/guards.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { createAuthGuards, type Principal } from '../../src/auth/guards.js';
import { signToken } from '../../src/identity/jwt.js';

const SECRET = 'x'.repeat(32);

function buildApp(resolveApiKey: (raw: string) => Promise<Principal | null>) {
  const guards = createAuthGuards({ jwtSecret: SECRET, keyPrefix: 'kl_', resolveApiKey });
  const app = new Hono();
  app.get('/any', guards.requireAuth, (c) => c.json(c.get('principal')));
  app.get('/jwt-only', guards.requireJwt, (c) => c.json(c.get('principal')));
  app.get('/admin', guards.requireAuth, guards.requireRole('admin'), (c) => c.text('ok'));
  app.get('/grown', guards.requireAuth, guards.requireRole('admin', 'adult'), (c) => c.text('ok'));
  return app;
}

const noKeys = async () => null;

describe('requireAuth', () => {
  it('accepts a valid JWT and exposes the principal', async () => {
    const app = buildApp(noKeys);
    const token = await signToken({ sub: 'u1', role: 'admin' }, SECRET, 3600);
    const res = await app.request('/any', { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ type: 'jwt', userId: 'u1', role: 'admin' });
  });

  it('accepts a valid API key via the resolver', async () => {
    const resolve = vi.fn(async (raw: string) =>
      raw === 'kl_secret' ? ({ type: 'api_key', userId: 'u2', role: 'child' } as Principal) : null
    );
    const app = buildApp(resolve);
    const res = await app.request('/any', { headers: { Authorization: 'Bearer kl_secret' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ type: 'api_key', userId: 'u2', role: 'child' });
  });

  it('401s a rejected API key', async () => {
    const app = buildApp(noKeys);
    const res = await app.request('/any', { headers: { Authorization: 'Bearer kl_bad' } });
    expect(res.status).toBe(401);
  });

  it('401s a missing header', async () => {
    const res = await buildApp(noKeys).request('/any');
    expect(res.status).toBe(401);
  });
});

describe('requireJwt', () => {
  it('rejects API-key auth on jwt-only routes', async () => {
    const resolve = async () => ({ type: 'api_key', userId: 'u', role: 'admin' } as Principal);
    const res = await buildApp(resolve).request('/jwt-only', {
      headers: { Authorization: 'Bearer kl_secret' },
    });
    expect(res.status).toBe(401);
  });

  it('accepts a JWT', async () => {
    const token = await signToken({ sub: 'u1', role: 'adult' }, SECRET, 3600);
    const res = await buildApp(noKeys).request('/jwt-only', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });
});

describe('requireRole', () => {
  it('allows an admin through an admin-only route', async () => {
    const token = await signToken({ sub: 'u1', role: 'admin' }, SECRET, 3600);
    const res = await buildApp(noKeys).request('/admin', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });

  it('403s a child on an admin-only route', async () => {
    const token = await signToken({ sub: 'u1', role: 'child' }, SECRET, 3600);
    const res = await buildApp(noKeys).request('/admin', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
  });

  it('allows any listed role (admin OR adult)', async () => {
    const token = await signToken({ sub: 'u1', role: 'adult' }, SECRET, 3600);
    const res = await buildApp(noKeys).request('/grown', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/auth/guards.test.ts`
Expected: FAIL — cannot resolve `../../src/auth/guards.js`.

- [ ] **Step 3: Write `src/auth/guards.ts`**

```ts
import type { MiddlewareHandler } from 'hono';
import { err } from '../http/response.js';
import { verifyToken } from '../identity/jwt.js';
import type { Role } from '../identity/schema.js';
import { detectAuthScheme } from './dispatch.js';

export interface Principal {
  type: 'api_key' | 'jwt';
  userId: string;
  role: Role;
}

declare module 'hono' {
  interface ContextVariableMap {
    principal?: Principal;
  }
}

export interface AuthGuardDeps {
  jwtSecret: string;
  /** App API-key prefix, e.g. `kl_` or `he_`. */
  keyPrefix: string;
  /** App bridge: validate a raw key and resolve its owning user + role. */
  resolveApiKey: (raw: string) => Promise<Principal | null>;
}

export interface AuthGuards {
  requireAuth: MiddlewareHandler;
  requireJwt: MiddlewareHandler;
  requireRole: (...roles: Role[]) => MiddlewareHandler;
}

export function createAuthGuards(deps: AuthGuardDeps): AuthGuards {
  const requireAuth: MiddlewareHandler = async (c, next) => {
    const header = c.req.header('Authorization');
    const scheme = detectAuthScheme(header, deps.keyPrefix);

    if (scheme === 'api_key') {
      const principal = await deps.resolveApiKey(header!.slice(7).trim());
      if (!principal) return err(c, 'UNAUTHORIZED', 'Invalid API key', 401);
      c.set('principal', principal);
      return next();
    }

    if (scheme === 'jwt') {
      try {
        const claims = await verifyToken(header!.slice(7).trim(), deps.jwtSecret);
        c.set('principal', { type: 'jwt', userId: claims.sub, role: claims.role });
        return next();
      } catch {
        return err(c, 'UNAUTHORIZED', 'Invalid token', 401);
      }
    }

    return err(c, 'UNAUTHORIZED', 'Authentication required', 401);
  };

  const requireJwt: MiddlewareHandler = async (c, next) => {
    const header = c.req.header('Authorization');
    if (detectAuthScheme(header, deps.keyPrefix) !== 'jwt') {
      return err(c, 'UNAUTHORIZED', 'JWT authentication required', 401);
    }
    try {
      const claims = await verifyToken(header!.slice(7).trim(), deps.jwtSecret);
      c.set('principal', { type: 'jwt', userId: claims.sub, role: claims.role });
      return next();
    } catch {
      return err(c, 'UNAUTHORIZED', 'Invalid token', 401);
    }
  };

  const requireRole =
    (...roles: Role[]): MiddlewareHandler =>
    async (c, next) => {
      const principal = c.get('principal');
      if (!principal) return err(c, 'UNAUTHORIZED', 'Authentication required', 401);
      if (!roles.includes(principal.role)) {
        return err(c, 'FORBIDDEN', 'Insufficient role', 403);
      }
      return next();
    };

  return { requireAuth, requireJwt, requireRole };
}
```

- [ ] **Step 4: Write `src/auth/index.ts`**

```ts
export * from './dispatch.js';
export * from './guards.js';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/auth/guards.test.ts`
Expected: PASS — 9 passed.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/auth/guards.ts src/auth/index.ts tests/auth/guards.test.ts
git commit -m "feat: add auth guards (requireAuth/requireJwt/requireRole)"
```

---

## Task 15: household — schema + service (optional module)

**Files:**
- Create: `src/household/schema.ts`
- Create: `src/household/service.ts`
- Create: `src/household/index.ts`
- Test: `tests/household/household.test.ts`

**Interfaces:**
- Consumes: `drizzle-orm/pg-core`, `drizzle-orm` (`sql`, `eq`); `users`, `Role` (Task 8); `CoreDb` (Task 7).
- Produces:
  - `household` table: `id` (uuid pk), `singleton` (boolean, unique, default true — enforces one row), `name`, `timezone` (default `'UTC'`), `locale` (default `'en-US'`), `createdAt`.
  - `type Household = typeof household.$inferSelect`
  - `interface SeedHouseholdInput { name: string; timezone?: string; locale?: string }`
  - `seedHousehold(db, input) → Promise<Household>` — returns existing singleton if present, else inserts.
  - `listMembers(db) → Promise<Array<{ id; email; handle; role; displayName; avatarColor }>>`
  - `setRole(db, userId, role) → Promise<User-row | null>`
  - `src/household/index.ts` barrel.

> **Testing note:** DB-round-trip behavior is covered by Heorth's integration tests. Unit tests here verify the singleton short-circuit and the schema shape via minimal stub `db` objects.

- [ ] **Step 1: Write the failing test**

`tests/household/household.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { household } from '../../src/household/schema.js';
import { seedHousehold, setRole } from '../../src/household/service.js';
import type { CoreDb } from '../../src/db/client.js';

describe('household schema', () => {
  it('has a singleton guard column plus name/timezone/locale', () => {
    const cols = Object.keys(household);
    expect(cols).toEqual(
      expect.arrayContaining(['id', 'singleton', 'name', 'timezone', 'locale', 'createdAt'])
    );
  });
});

describe('seedHousehold', () => {
  it('returns the existing household without inserting when one exists', async () => {
    const existing = { id: 'h1', singleton: true, name: 'Home', timezone: 'UTC', locale: 'en-US', createdAt: new Date() };
    const insert = vi.fn();
    const db = {
      select: () => ({ from: () => ({ limit: async () => [existing] }) }),
      insert,
    } as unknown as CoreDb;

    const result = await seedHousehold(db, { name: 'Ignored' });
    expect(result).toBe(existing);
    expect(insert).not.toHaveBeenCalled();
  });

  it('inserts with defaults when none exists', async () => {
    const created = { id: 'h2', singleton: true, name: 'Home', timezone: 'UTC', locale: 'en-US', createdAt: new Date() };
    const values = vi.fn(() => ({ returning: async () => [created] }));
    const db = {
      select: () => ({ from: () => ({ limit: async () => [] }) }),
      insert: () => ({ values }),
    } as unknown as CoreDb;

    const result = await seedHousehold(db, { name: 'Home' });
    expect(result).toBe(created);
    expect(values).toHaveBeenCalledWith({ name: 'Home', timezone: 'UTC', locale: 'en-US' });
  });
});

describe('setRole', () => {
  it('updates the user role and returns the row', async () => {
    const updated = { id: 'u1', role: 'child' };
    const db = {
      update: () => ({ set: () => ({ where: () => ({ returning: async () => [updated] }) }) }),
    } as unknown as CoreDb;

    const result = await setRole(db, 'u1', 'child');
    expect(result).toBe(updated);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/household/household.test.ts`
Expected: FAIL — cannot resolve `../../src/household/schema.js`.

- [ ] **Step 3: Write `src/household/schema.ts`**

```ts
import { pgTable, text, uuid, timestamp, boolean } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * The one household per instance. `singleton` is a UNIQUE boolean fixed to
 * `true`, so a second insert (also `true`) violates the constraint — enforcing
 * a single row at the DB level.
 */
export const household = pgTable('household', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  singleton: boolean('singleton').notNull().default(true).unique(),
  name: text('name').notNull(),
  timezone: text('timezone').notNull().default('UTC'),
  locale: text('locale').notNull().default('en-US'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
});

export type Household = typeof household.$inferSelect;
```

- [ ] **Step 4: Write `src/household/service.ts`**

```ts
import { eq } from 'drizzle-orm';
import type { CoreDb } from '../db/client.js';
import { users, type Role } from '../identity/schema.js';
import { household, type Household } from './schema.js';

export interface SeedHouseholdInput {
  name: string;
  timezone?: string;
  locale?: string;
}

/** Create the singleton household at first boot; idempotent. */
export async function seedHousehold(db: CoreDb, input: SeedHouseholdInput): Promise<Household> {
  const [existing] = await db.select().from(household).limit(1);
  if (existing) return existing;

  const [row] = await db
    .insert(household)
    .values({
      name: input.name,
      timezone: input.timezone ?? 'UTC',
      locale: input.locale ?? 'en-US',
    })
    .returning();
  if (!row) throw new Error('Failed to seed household');
  return row;
}

/** Every user in the instance belongs to the one household; role lives on the user. */
export async function listMembers(db: CoreDb) {
  return db
    .select({
      id: users.id,
      email: users.email,
      handle: users.handle,
      role: users.role,
      displayName: users.displayName,
      avatarColor: users.avatarColor,
    })
    .from(users)
    .orderBy(users.createdAt);
}

export async function setRole(db: CoreDb, userId: string, role: Role) {
  const [row] = await db
    .update(users)
    .set({ role, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning();
  return row ?? null;
}
```

- [ ] **Step 5: Write `src/household/index.ts`**

```ts
export * from './schema.js';
export * from './service.js';
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/household/household.test.ts`
Expected: PASS — 4 passed.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/household tests/household
git commit -m "feat: add optional household module"
```

---

## Task 16: db schema barrels + drizzle-kit config + core migrations

**Files:**
- Create: `src/db/schema/index.ts`
- Create: `src/db/schema/drizzle-schema.ts`
- Create: `drizzle.config.ts`
- Create (generated): `src/db/migrations/**`
- Test: `tests/db/schema-barrel.test.ts`

**Interfaces:**
- Consumes: `identity/schema` (Task 8), `household/schema` (Task 15).
- Produces:
  - `src/db/schema/index.ts` — ESM runtime barrel (uses `.js` extensions) exporting `users`, `apiKeys`, `userRole`, `household`. Apps pass this object as `schema` to `createDb`.
  - `src/db/schema/drizzle-schema.ts` — identical re-exports **without** `.js` extensions, for drizzle-kit's CJS bundler.
  - `drizzle.config.ts` — `schema: './src/db/schema/drizzle-schema.ts'`, `out: './src/db/migrations'`, `dialect: 'postgresql'`.
  - Generated migration SQL under `src/db/migrations/` for the `users`, `api_keys`, and `household` tables + `user_role` enum.

> **The dual-export gotcha:** runtime code imports `./schema/index.js` (ESM needs the `.js` suffix). drizzle-kit bundles as CJS and cannot resolve those `.js` suffixes, so `drizzle.config.ts` points at `drizzle-schema.ts`, which re-exports **without** suffixes. The `db:*` scripts run drizzle-kit through `tsx`.

- [ ] **Step 1: Write the failing test**

`tests/db/schema-barrel.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as schema from '../../src/db/schema/index.js';

describe('db schema barrel', () => {
  it('re-exports the identity and household tables', () => {
    expect(schema.users).toBeDefined();
    expect(schema.apiKeys).toBeDefined();
    expect(schema.userRole).toBeDefined();
    expect(schema.household).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/db/schema-barrel.test.ts`
Expected: FAIL — cannot resolve `../../src/db/schema/index.js`.

- [ ] **Step 3: Write `src/db/schema/index.ts`** (ESM runtime — `.js` suffixes)

```ts
// Runtime barrel — ESM requires the .js extension even for .ts sources.
export * from '../../identity/schema.js';
export * from '../../household/schema.js';
```

- [ ] **Step 4: Write `src/db/schema/drizzle-schema.ts`** (drizzle-kit — no suffixes)

```ts
// drizzle-kit's CJS bundler cannot resolve .js suffixes on .ts files; this
// suffix-free mirror of ./index.ts is the one drizzle.config.ts points at.
export * from '../../identity/schema';
export * from '../../household/schema';
```

- [ ] **Step 5: Write `drizzle.config.ts`**

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema/drizzle-schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? 'postgres://postgres:postgres@localhost:5432/wyrhta_core',
  },
});
```

- [ ] **Step 6: Generate the migration SQL**

Run: `npm run db:generate`
Expected: drizzle-kit prints the tables it detected and writes `src/db/migrations/0000_*.sql` plus `src/db/migrations/meta/`. The SQL should contain `CREATE TYPE "public"."user_role"`, `CREATE TABLE "users"`, `CREATE TABLE "api_keys"`, and `CREATE TABLE "household"`.

- [ ] **Step 7: Sanity-check the generated SQL**

Open `src/db/migrations/0000_*.sql` and confirm:
- `user_role` enum has values `'admin', 'adult', 'child'`.
- `api_keys.user_id` has a foreign key to `users(id)` with `ON DELETE cascade`.
- `household.singleton` carries a UNIQUE constraint.

(No code change; this is a review gate. If anything is wrong, fix the schema in Task 8/15, re-run `db:generate`, and re-review.)

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx vitest run tests/db/schema-barrel.test.ts`
Expected: PASS — 1 passed.

- [ ] **Step 9: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 10: Commit**

```bash
git add src/db/schema drizzle.config.ts src/db/migrations tests/db/schema-barrel.test.ts
git commit -m "feat: add db schema barrels, drizzle config, and core migrations"
```

---

## Task 17: mcp — McpTool types + createMcpServer scaffold

**Files:**
- Create: `src/mcp/types.ts`
- Create: `src/mcp/scaffold.ts`
- Create: `src/mcp/index.ts`
- Test: `tests/mcp/scaffold.test.ts`

**Interfaces:**
- Consumes: `@modelcontextprotocol/sdk/server/mcp.js` (`McpServer`); `logEvent`, `logError` (Task 4); `zod` (`ZodRawShape`); test-only: `@modelcontextprotocol/sdk/client/index.js` (`Client`), `@modelcontextprotocol/sdk/inMemory.js` (`InMemoryTransport`).
- Produces:
  - `interface McpPrincipal { userId: string; role: 'admin' | 'adult' | 'child' }`
  - `interface McpToolContext { principal: McpPrincipal; requestId: string }`
  - `interface McpToolResult { content: Array<{ type: 'text'; text: string }>; isError?: boolean }`
  - `interface McpTool { name: string; description: string; inputSchema: z.ZodRawShape; handler: (ctx: McpToolContext, input: Record<string, unknown>) => Promise<McpToolResult> }`
  - `interface AuthAdapter { resolve: () => Promise<McpPrincipal> }`
  - `createMcpServer(registry: McpTool[], authAdapter: AuthAdapter, info?: { name: string; version: string }) → McpServer` — registers each tool; each call authenticates via `authAdapter.resolve()`, audit-logs, then runs the handler; failures return an `isError` result.
  - `src/mcp/index.ts` barrel.

> **Scaffold scope:** this stands up the server and wires tools through a single auth + audit path (as the spec requires). Per-transport auth wiring (extracting an API key from an HTTP/stdio session into `authAdapter`) is completed by each consuming app; `@modelcontextprotocol/sdk` `1.x` `registerTool` takes a Zod raw shape as `inputSchema`.

- [ ] **Step 1: Write the failing test**

`tests/mcp/scaffold.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../../src/mcp/scaffold.js';
import type { McpTool, AuthAdapter, McpPrincipal } from '../../src/mcp/types.js';

const principal: McpPrincipal = { userId: 'u1', role: 'admin' };

function echoTool(spy?: (ctx: unknown) => void): McpTool {
  return {
    name: 'echo',
    description: 'Echo a message back',
    inputSchema: { message: z.string() },
    handler: async (ctx, input) => {
      spy?.(ctx);
      return { content: [{ type: 'text', text: String(input['message']) }] };
    },
  };
}

async function connect(server: ReturnType<typeof createMcpServer>) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

describe('createMcpServer', () => {
  it('registers tools that can be listed', async () => {
    const adapter: AuthAdapter = { resolve: async () => principal };
    const client = await connect(createMcpServer([echoTool()], adapter));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('echo');
  });

  it('runs a tool through the auth adapter and returns its content', async () => {
    const resolve = vi.fn(async () => principal);
    const ctxSpy = vi.fn();
    const client = await connect(createMcpServer([echoTool(ctxSpy)], { resolve }));
    const result = await client.callTool({ name: 'echo', arguments: { message: 'hi' } });
    expect(resolve).toHaveBeenCalledOnce();
    expect((result.content as Array<{ text: string }>)[0]!.text).toBe('hi');
    expect(ctxSpy).toHaveBeenCalledWith(expect.objectContaining({ principal }));
  });

  it('returns an error result when the auth adapter rejects', async () => {
    const adapter: AuthAdapter = {
      resolve: async () => {
        throw new Error('unauthorized');
      },
    };
    const client = await connect(createMcpServer([echoTool()], adapter));
    const result = await client.callTool({ name: 'echo', arguments: { message: 'hi' } });
    expect(result.isError).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mcp/scaffold.test.ts`
Expected: FAIL — cannot resolve `../../src/mcp/scaffold.js`.

- [ ] **Step 3: Write `src/mcp/types.ts`**

```ts
import type { z } from 'zod';

export interface McpPrincipal {
  userId: string;
  role: 'admin' | 'adult' | 'child';
}

export interface McpToolContext {
  principal: McpPrincipal;
  requestId: string;
}

export interface McpToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export interface McpTool {
  name: string;
  description: string;
  /** Zod raw shape (object of Zod types), as `registerTool` expects. */
  inputSchema: z.ZodRawShape;
  handler: (ctx: McpToolContext, input: Record<string, unknown>) => Promise<McpToolResult>;
}

/** App-provided bridge that resolves the authenticated caller (API key → user + role). */
export interface AuthAdapter {
  resolve: () => Promise<McpPrincipal>;
}
```

- [ ] **Step 4: Write `src/mcp/scaffold.ts`**

```ts
import { randomUUID } from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { logEvent, logError } from '../lib/logger.js';
import type { AuthAdapter, McpTool } from './types.js';

/**
 * Assemble an MCP server from a tool registry. Every tool call runs through the
 * same auth (`authAdapter.resolve`) and the same audit logger as REST, then
 * delegates to the tool's handler with a typed context.
 */
export function createMcpServer(
  registry: McpTool[],
  authAdapter: AuthAdapter,
  info: { name: string; version: string } = { name: '@wyrhta/core', version: '0.1.0' }
): McpServer {
  const server = new McpServer(info);

  for (const tool of registry) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      async (input: Record<string, unknown>) => {
        const requestId = randomUUID();
        try {
          const principal = await authAdapter.resolve();
          logEvent({
            event: 'mcp.tool.call',
            request_id: requestId,
            tool: tool.name,
            user_id: principal.userId,
          });
          return await tool.handler({ principal, requestId }, input);
        } catch (error) {
          logError(`mcp tool ${tool.name} failed`, error);
          return {
            content: [{ type: 'text' as const, text: 'Unauthorized or tool error' }],
            isError: true,
          };
        }
      }
    );
  }

  return server;
}
```

- [ ] **Step 5: Write `src/mcp/index.ts`**

```ts
export * from './types.js';
export * from './scaffold.js';
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/mcp/scaffold.test.ts`
Expected: PASS — 3 passed.

> If `registerTool`'s handler receives `(args, extra)` in the installed SDK version, `input` is the first arg (already the case above). If the pinned SDK's `registerTool` signature differs, confirm against `@modelcontextprotocol/sdk` `1.x` docs before adjusting — do not change the pinned version without updating the Global Constraints table.

- [ ] **Step 7: Commit**

```bash
git add src/mcp tests/mcp
git commit -m "feat: add mcp scaffold and tool types"
```

---

## Task 18: Final wiring — build, full test run, verification

**Files:**
- Modify: `src/index.ts`
- Test: (whole suite)

**Interfaces:**
- Consumes: every prior barrel.
- Produces: a clean `npm run build` (emits `dist/` with `.d.ts`), a green full `npm test`, and a root barrel that re-exports the version plus the subpath surfaces for convenience.

- [ ] **Step 1: Expand `src/index.ts` to a root barrel**

```ts
export const CORE_VERSION = '0.1.0';

export * from './config/index.js';
export * from './lib/index.js';
export * from './http/index.js';
export * from './identity/index.js';
export * from './auth/index.js';
export * from './household/index.js';
export * from './mcp/index.js';
export * from './db/index.js';
```

- [ ] **Step 2: Typecheck the whole package**

Run: `npm run typecheck`
Expected: exit 0, no output.

> If the barrel surfaces a name collision (e.g. two modules export `Meta`), disambiguate at the source module rather than here. Cross-check the `Produces` blocks: `hashKey` is exported from both `lib` and `identity/api-key` (re-export of the same symbol) — that is safe; a *different* symbol with the same name would not be.

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: PASS — all test files green (config, lib/crypto, lib/logger, http/response, http/pagination, http/middleware, db/client, db/schema-barrel, identity/schema, identity/password, identity/jwt, identity/api-key, identity/service, auth/dispatch, auth/guards, household, mcp, smoke).

- [ ] **Step 4: Build the package**

Run: `npm run build`
Expected: exit 0; `dist/` contains `index.js`, `index.d.ts`, and one subdirectory per module (`config`, `lib`, `http`, `identity`, `auth`, `household`, `mcp`, `db`), each with an `index.js` + `index.d.ts` matching the `exports` map in `package.json`.

- [ ] **Step 5: Verify the subpath export map resolves against dist**

Run: `node -e "import('@wyrhta/core/http').then(m => console.log(typeof m.ok)).catch(e => { console.error(e); process.exit(1); })"`
Expected: prints `function` (resolves `./dist/http/index.js` via the `exports` map; requires the package to be importable by name — run from the package root where `node` resolves the local `package.json`, or after `npm link`/`npm pack`).

> If the bare-specifier import cannot resolve in your environment, fall back to verifying the dist file directly:
> Run: `node -e "import('./dist/http/index.js').then(m => console.log(typeof m.ok))"`
> Expected: prints `function`.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire root barrel and verify build"
```

- [ ] **Step 7: Tag the release for git-tag consumption**

```bash
git tag v0.1.0
```

Expected: tag `v0.1.0` created. Consuming repos depend on it via `"@wyrhta/core": "github:wyrhta-labs/core#v0.1.0"` (or the equivalent git URL); their `npm install` triggers core's `prepare` → `build`, producing `dist/`.

---

## Self-Review

### 1. Spec coverage

| Spec requirement | Task |
|---|---|
| Package shape, `"type": "module"`, subpath exports | 1 |
| `lib/crypto` — generate/hash, configurable prefix | 3 |
| `lib/logger` — logEvent/logError | 4 |
| `http/response` envelope `{data,meta}` / `{error}` | 5 |
| `http/pagination` — max 100 | 5 |
| `http/envelope` shared types | 5 |
| `http/middleware` — request-id, security-headers, rate-limit, error-handler | 6 |
| `db/client` factory (postgres.js) | 7 |
| `db/migrate` programmatic runner | 7 |
| `identity/schema` — users (argon2id hash, role enum), api_keys | 8 |
| argon2id password hash/verify | 9 |
| JWT HS256, `sub`+`role`, 3-arg verify | 10 |
| api-key generate/hash/validate, configurable prefix | 3, 11 |
| identity service — createUser, authenticate, issueToken, keys CRUD | 12 |
| auth dispatch — `prefix_`→key, `eyJ`→jwt | 13 |
| guards — requireAuth, requireJwt, requireRole(...roles) | 14 |
| household — singleton, seedHousehold, listMembers, setRole | 15 |
| DB conventions — `withTimezone`, `.js`/no-`.js` dual export, drizzle-kit via tsx, 23505→CONFLICT | 8, 12, 16 |
| `JWT_SECRET` min 32 at env-validation | 2 |
| MCP scaffold — createMcpServer(registry, authAdapter), McpTool, official SDK, pinned version | 17 |
| Unit-test coverage: password, jwt, api-key, envelope, guards, dispatch | 3–14 |
| git-tag consumption, `prepare`→build | 1, 18 |

No spec requirement is left without a task.

### 2. Placeholder scan

No `TBD`/`TODO`/"add error handling"/"write tests for the above"/"similar to Task N" appear. Every code step carries complete code; every command step carries an expected result. The two review-gate steps (Task 16 Step 7 schema SQL review; Task 17 Step 6 SDK-signature note) reference concrete, checkable conditions rather than deferred work.

### 3. Type consistency

- `generateApiKey({ prefix })` → `{ raw, hash, prefix }` (Task 3) is consumed by `generateKey(prefix)` (Task 11) and `createApiKey` (Task 12) — signatures match.
- `Role` (Task 8) flows into `TokenClaims` (10), `Principal` (14), `CreateUserInput`/`issueToken` (12), `setRole` (15) — consistent union `'admin'|'adult'|'child'`.
- `CoreDb` (Task 7) is the `db` param type used uniformly in identity service (12) and household service (15).
- `verifyToken(token, secret, algorithm='HS256')` (10) is called by guards (14) with two args (algorithm defaulted) — consistent.
- `Principal` (14) is what `resolveApiKey` returns and what `requireRole` reads from `c.get('principal')` — consistent; Hono `ContextVariableMap` augmented in both `request-id.ts` (`requestId`) and `guards.ts` (`principal`), which merge.
- `McpTool.inputSchema: z.ZodRawShape` (17) matches `registerTool(name, { inputSchema }, handler)` in the pinned SDK.
- `ok`/`err` status union in `response.ts` (5) includes `429`, used by the rate limiter path and general errors.
- `hashKey` is exported from `lib/crypto` (3) and re-exported from `identity/api-key` (11) — same symbol, safe.

No naming or signature drift found.

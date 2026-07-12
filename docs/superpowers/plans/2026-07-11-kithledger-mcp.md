# KithLedger — Refactor onto @wyrhta/core + MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the existing KithLedger REST service onto the shared `@wyrhta/core` package (swapping its in-repo HTTP/auth/crypto primitives for core's, and migrating single-`ADMIN_PASSWORD` login to a single-user deployment of core's identity), then add an MCP server that exposes KithLedger's domain as `kith.*` tools calling the existing service layer directly.

**Architecture:** KithLedger keeps its own domain (people, interactions, reminders, relationships) — schema, validators, services and REST routes stay behavior-identical. Only the *moved primitives* change their import source. Identity (`users` + `api_keys`) becomes core's tables; first boot seeds one `admin` user from `ADMIN_PASSWORD`; `POST /auth/token` authenticates that user and returns a core-issued JWT; API keys keep the `kl_` prefix. Part 2 adds `src/mcp/` which registers each domain area as core `McpTool`s that invoke the same services as REST, behind a `kl_`-key auth adapter that resolves to the admin user.

**Tech Stack:** Node.js 22 + TypeScript (ESM, `"type": "module"`), Hono, Drizzle ORM + postgres.js, PostgreSQL 16, Zod, Vitest (integration tests against a real Postgres, `singleFork: true`, truncate-per-test), `@wyrhta/core` (git-tag dependency).

## Global Constraints

These apply to **every** task below.

- **Node 22 + TypeScript, ESM only.** `package.json` has `"type": "module"`. Runtime relative imports use the `.js` extension (e.g. `./db/index.js`); `tsconfig` uses `"moduleResolution": "bundler"`, `"target"/"module": "ES2022"`, `"strict": true`.
- **Core is a git-tag dependency** — no npm registry pre-1.0. Add as `"@wyrhta/core": "github:wyrhta-labs/wyrhta-core#<tag>"`. Use the latest published core tag; this plan was written against the core design dated 2026-07-11.
- **Layering unchanged:** `routes/` → `services/` → `db/`. Routes never touch Drizzle directly. MCP tool handlers call `services/` directly (never HTTP).
- **Response envelope:** `{ data, meta }` on success, `{ error: { code, message } }` on failure. Pagination `?limit&offset`, **max 100**. Do not change any envelope shape or status code.
- **Auth dispatch:** `Bearer kl_…` → API-key path; `Bearer eyJ…` → JWT path. Key-management routes (`/api/v1/auth/keys*`) reject API-key auth (JWT only).
- **API key prefix stays `kl_`.** Raw key = `kl_` + 32-byte hex; only the SHA-256 hash is stored; raw returned once at creation.
- **`JWT_SECRET` minimum 32 chars**, enforced at env validation; shorter values exit at startup.
- **`hono/jwt` `verify()` takes 3 args:** `verify(token, secret, 'HS256')`.
- **Drizzle uses `timestamp('col', { withTimezone: true })`** — there is no `timestamptz` export. Postgres UNIQUE violation = error code `23505`.
- **`drizzle-kit` runs via `tsx`** (the `db:*` scripts). Schema files use `.js`-extension imports; `src/db/schema/drizzle-schema.ts` re-exports them without `.js` for drizzle-kit's CJS bundler.
- **Migrations run programmatically at startup** in `src/index.ts` before `serve()`.
- **Audit logging:** use core's `logEvent`/`logError` for security-relevant actions (auth, key lifecycle, MCP tool calls). Structured JSON to stdout.
- **Acceptance for Part 1:** the existing integration tests (`tests/people.test.ts`, `tests/interactions.test.ts`, `tests/reminders.test.ts`, `tests/relationships.test.ts`) pass **unchanged**.
- **Never** add a `Co-Authored-By: Claude` (or similar AI) trailer to commits.

### Assumed `@wyrhta/core` surface (canonical export names from the core design; wiring signatures marked ASSUMED)

The core design spec names the exports below. Names are canonical — do **not** rename them. Where the spec does not pin an exact call signature, this plan assumes a small **factory** shape so the app can inject its own `db`, `jwtSecret`, and key prefix. **All core wiring is centralized in `src/identity.ts`** — if core turns out to use module-level config init instead of factories, only that one file changes.

```ts
// @wyrhta/core/identity
export const users;        // Drizzle table: id, email(unique), handle(unique), password_hash, role, display_name, avatar_color, created_at, updated_at
export const apiKeys;      // Drizzle table: id, user_id(FK users.id), name, key_hash, prefix, last_used_at, created_at
export type User; export type ApiKey;
export function createIdentityService(cfg: {          // ASSUMED factory
  db: DB; jwtSecret: string; jwtTtlSeconds: number; apiKeyPrefix: string;
}): {
  createUser(input: { email: string; handle: string; password: string;
                      role: 'admin'|'adult'|'child'; displayName?: string; avatarColor?: string }): Promise<User>;
  authenticate(input: { email: string; password: string }): Promise<User | null>; // argon2 verify
  issueToken(user: User): Promise<{ token: string; expiresIn: number }>;           // HS256, sub=user.id, role
  createApiKey(input: { userId: string; name: string }): Promise<{ id: string; name: string; raw: string; prefix: string; createdAt: Date }>;
  listApiKeys(userId: string): Promise<Array<{ id: string; name: string; prefix: string; createdAt: Date; lastUsedAt: Date | null }>>;
  revokeApiKey(id: string): Promise<{ id: string } | null>;
  validateApiKey(raw: string): Promise<{ userId: string; keyId: string; name: string } | null>; // SHA-256 lookup + touch last_used_at
};

// @wyrhta/core/auth
export function createAuthGuards(cfg: { db: DB; jwtSecret: string }): {   // ASSUMED factory
  requireAuth: MiddlewareHandler;   // key OR jwt; JWT branch verifies signature+exp+string `sub`, sets c.get('auth'); NO db user lookup on the JWT path
  requireJwt: MiddlewareHandler;    // jwt only (rejects kl_ keys)
  requireRole: (...roles: string[]) => MiddlewareHandler;
};
// c.get('auth') === { type: 'api_key'|'jwt', userId: string, role?: string, apiKeyId?: string, apiKeyName?: string }

// @wyrhta/core/http
export function ok<T>(c: Context, data: T, meta?: Meta, status?: 200 | 201): Response;
export function err(c: Context, code: string, message: string, status?: 400|401|403|404|409|500): Response;
export function parsePagination(query: Record<string, string | undefined>): { limit: number; offset: number };
// @wyrhta/core/http/middleware
export const requestId: MiddlewareHandler;       // sets c.get('requestId') + X-Request-Id header
export const securityHeaders: MiddlewareHandler;
export const rateLimit: MiddlewareHandler;        // in-memory, 10 req / 15 min
export const errorHandler: ErrorHandler;          // ZodError -> 400 VALIDATION_ERROR; else 500 INTERNAL_ERROR

// @wyrhta/core/lib
export function logEvent(e: Record<string, unknown> & { event: string }): void;
export function logError(message: string, error: unknown): void;
export function generateApiKey(opts: { prefix: string }): { raw: string; hash: string; prefix: string };

// @wyrhta/core/mcp
export interface McpContext { userId: string; role: string; requestId: string }
export interface McpTool { name: string; description: string; inputSchema: import('zod').ZodTypeAny;
                           handler: (ctx: McpContext, input: unknown) => Promise<unknown> }
export type McpAuthAdapter = (credential: string) => Promise<{ userId: string; role: string } | null>;
export function createMcpServer(registry: McpTool[], authAdapter: McpAuthAdapter): {
  listTools(): McpTool[];
  connect(): Promise<void>;   // stdio transport
};
```

**Assumption A1 (critical for the Part-1 acceptance criterion):** core's `requireAuth`/`requireJwt` JWT branch verifies signature + expiry + presence of a string `sub` claim and does **not** require `sub` to resolve to a `users` row, and treats a missing `role` claim as absent (not an error). The existing tests hand-sign `{ sub: 'admin' }` tokens with no `role`; they must keep passing. If core's guard instead does a DB user lookup or requires `role`, escalate — the acceptance criterion cannot be met without changing core or the tests.

---

# PART 1 — Refactor onto @wyrhta/core

## Task 1: Add `@wyrhta/core` dependency and the centralized wiring module

Adds the git-tag dependency and the single file (`src/identity.ts`) that wires core's identity service and auth guards to KithLedger's `db` + config. Every later task imports guards/identity from here.

**Files:**
- Modify: `package.json` (add dependency)
- Create: `src/identity.ts`
- Test: `tests/identity.wiring.test.ts`

**Interfaces:**
- Produces: `src/identity.ts` exports `identity` (the core identity service instance), `requireAuth`, `requireJwt`, `requireRole` (core guards), `API_KEY_PREFIX = 'kl_'`, `ADMIN_EMAIL`, `ADMIN_HANDLE`, `seedAdmin(): Promise<void>`, `getAdminUser(): Promise<User>`.

- [ ] **Step 1: Add the dependency to `package.json`**

Add to the `"dependencies"` block (keep the rest of the file unchanged):

```jsonc
  "dependencies": {
    "@hono/node-server": "^1.13.7",
    "@wyrhta/core": "github:wyrhta-labs/wyrhta-core#0.1.0",
    "drizzle-orm": "^0.39.3",
    "hono": "^4.7.4",
    "postgres": "^3.4.5",
    "zod": "^3.24.2"
  },
```

> If a newer core tag exists, use it. Confirm the exact tag with `gh release list --repo wyrhta-labs/wyrhta-core`.

- [ ] **Step 2: Install and verify resolution**

Run: `npm install`
Expected: completes without error; `node_modules/@wyrhta/core/package.json` exists. Then `npm ls @wyrhta/core` prints the resolved git ref.

- [ ] **Step 3: Write the failing wiring test**

Create `tests/identity.wiring.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { identity, requireAuth, requireJwt, API_KEY_PREFIX, seedAdmin, getAdminUser } from '../src/identity.js';

describe('identity wiring', () => {
  it('exposes a configured core identity service and guards', () => {
    expect(API_KEY_PREFIX).toBe('kl_');
    expect(typeof identity.authenticate).toBe('function');
    expect(typeof identity.issueToken).toBe('function');
    expect(typeof identity.createApiKey).toBe('function');
    expect(typeof identity.validateApiKey).toBe('function');
    expect(typeof requireAuth).toBe('function');
    expect(typeof requireJwt).toBe('function');
    expect(typeof seedAdmin).toBe('function');
    expect(typeof getAdminUser).toBe('function');
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npm test -- tests/identity.wiring.test.ts`
Expected: FAIL — `Cannot find module '../src/identity.js'`.

- [ ] **Step 5: Create `src/identity.ts`**

```ts
import { createIdentityService, users, type User } from '@wyrhta/core/identity';
import { createAuthGuards } from '@wyrhta/core/auth';
import { eq } from 'drizzle-orm';
import { db } from './db/index.js';
import { config } from './config/env.js';

/** KithLedger keeps the historical API-key prefix. */
export const API_KEY_PREFIX = 'kl_';

/** Single-user deployment: one seeded admin identifies the whole instance. */
export const ADMIN_EMAIL = 'admin@kithledger.local';
export const ADMIN_HANDLE = 'admin';

/** Core identity service, wired to KithLedger's db + config in one place. */
export const identity = createIdentityService({
  db,
  jwtSecret: config.jwtSecret,
  jwtTtlSeconds: config.jwtTtlSeconds,
  apiKeyPrefix: API_KEY_PREFIX,
});

/** Core auth guards, wired to the same db + secret. */
export const { requireAuth, requireJwt, requireRole } = createAuthGuards({
  db,
  jwtSecret: config.jwtSecret,
});

/** Idempotently seed the single admin user from ADMIN_PASSWORD (first boot). */
export async function seedAdmin(): Promise<void> {
  const [existing] = await db.select().from(users).where(eq(users.handle, ADMIN_HANDLE)).limit(1);
  if (existing) return;
  await identity.createUser({
    email: ADMIN_EMAIL,
    handle: ADMIN_HANDLE,
    password: config.adminPassword,
    role: 'admin',
    displayName: 'Administrator',
  });
}

/** Resolve the single admin user; throws if the instance was never seeded. */
export async function getAdminUser(): Promise<User> {
  const [row] = await db.select().from(users).where(eq(users.handle, ADMIN_HANDLE)).limit(1);
  if (!row) throw new Error('Admin user not seeded — run seedAdmin() at startup');
  return row;
}

export type { User };
```

- [ ] **Step 6: Run the wiring test + typecheck**

Run: `npm test -- tests/identity.wiring.test.ts` → Expected: PASS.
Run: `npm run typecheck` → Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/identity.ts tests/identity.wiring.test.ts
git commit -m "feat: add @wyrhta/core dependency and centralized identity/auth wiring"
```

---

## Task 2: Adopt core's response envelope and pagination

Replace the in-repo `src/lib/response.ts` and `src/lib/pagination.ts` with imports from `@wyrhta/core/http`, then delete the local files. Behavior must be identical.

**Files:**
- Delete: `src/lib/response.ts`, `src/lib/pagination.ts`
- Modify (import swap only): `src/routes/auth.ts`, `src/routes/health.ts`, `src/routes/people.ts`, `src/routes/interactions.ts`, `src/routes/reminders.ts`, `src/routes/relationships.ts`, `src/routes/index.ts`
- Test: existing `tests/*.test.ts` (unchanged)

**Interfaces:**
- Consumes: `ok`, `err`, `parsePagination` from `@wyrhta/core/http` (identical signatures to the deleted local versions — see Global Constraints).

- [ ] **Step 1: Confirm the current importers (baseline)**

Run: `grep -rn "lib/response.js\|lib/pagination.js" src`
Expected: lists every route importing `ok`/`err` from `../lib/response.js`. (`parsePagination` is not currently imported anywhere — services do inline clamping; leave services untouched.)

- [ ] **Step 2: Swap imports in every route file**

In each of `src/routes/auth.ts`, `health.ts`, `people.ts`, `interactions.ts`, `reminders.ts`, `relationships.ts`, and `src/routes/index.ts`, replace:

```ts
import { ok, err } from '../lib/response.js';
```

with:

```ts
import { ok, err } from '@wyrhta/core/http';
```

(In `src/routes/index.ts` the current line is `import { ok, err } from '../lib/response.js';` — same replacement.)

- [ ] **Step 3: Delete the local files**

```bash
git rm src/lib/response.ts src/lib/pagination.ts
```

- [ ] **Step 4: Typecheck to prove no dangling references**

Run: `npm run typecheck`
Expected: no errors. (If any file still imports `../lib/response.js` or `../lib/pagination.js`, it fails here — fix the import.)

- [ ] **Step 5: Run the full suite (acceptance)**

Run: `npm test`
Expected: all existing tests PASS unchanged.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: use @wyrhta/core envelope and pagination"
```

---

## Task 3: Adopt core's middleware (request-id, security-headers, rate-limit, error-handler)

Swap the four in-repo middleware for core's and delete the local copies. Wire them in `app.ts` and the auth router.

**Files:**
- Delete: `src/middleware/request-id.ts`, `src/middleware/security-headers.ts`, `src/middleware/rate-limit.ts`, `src/middleware/error-handler.ts`
- Modify: `src/app.ts`, `src/routes/auth.ts`
- Test: existing `tests/*.test.ts`

**Interfaces:**
- Consumes: `requestId`, `securityHeaders`, `rateLimit`, `errorHandler` from `@wyrhta/core/http/middleware`.

- [ ] **Step 1: Update `src/app.ts` to import core middleware**

Replace the three local middleware imports (lines importing `./middleware/error-handler.js`, `./middleware/security-headers.js`, `./middleware/request-id.js`) with a single core import. The full new top-of-file import block:

```ts
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { trimTrailingSlash } from 'hono/trailing-slash';
import { serveStatic } from '@hono/node-server/serve-static';
import { config } from './config/env.js';
import { mountRoutes } from './routes/index.js';
import { errorHandler, securityHeaders, requestId } from '@wyrhta/core/http/middleware';
```

Leave the rest of `createApp()` unchanged — the middleware order (`trimTrailingSlash` → `requestId` → `securityHeaders` → `logger` → `cors` → `bodyLimit`) and the `app.onError(errorHandler)` call stay exactly as they are.

- [ ] **Step 2: Update `src/routes/auth.ts` to use core's rate limiter**

Replace `import { rateLimitMiddleware } from '../middleware/rate-limit.js';` with:

```ts
import { rateLimit } from '@wyrhta/core/http/middleware';
```

Update the one usage on the `/token` route from `rateLimitMiddleware` to `rateLimit`:

```ts
authRouter.post('/token', rateLimit, async (c) => {
```

Also update the `getIp` helper's type annotation that referenced `rateLimitMiddleware`:

```ts
function getIp(c: Parameters<typeof rateLimit>[0]): string {
```

(Auth-route body logic is refactored in Task 7; only the rate-limit symbol changes here.)

- [ ] **Step 3: Delete the local middleware files**

```bash
git rm src/middleware/request-id.ts src/middleware/security-headers.ts src/middleware/rate-limit.ts src/middleware/error-handler.ts
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Run the suite + verify security headers unchanged**

Run: `npm test`
Expected: all PASS. In particular `tests/people.test.ts` still returns 401 for unauthenticated and 200/201 for authenticated requests (proving `requestId`/`securityHeaders` do not break the pipeline).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: use @wyrhta/core request-id, security-headers, rate-limit, error-handler"
```

---

## Task 4: Adopt core's structured logger and crypto/api-key

Swap `src/lib/logger.ts` and `src/lib/crypto.ts` for core's, delete the local files, and update importers. Core's `generateApiKey` takes a `{ prefix }` argument.

**Files:**
- Delete: `src/lib/logger.ts`, `src/lib/crypto.ts`
- Modify: `src/routes/auth.ts` (temporary until Task 7 rewrites it), `src/middleware/api-key.ts` (temporary until Task 7 deletes it)
- Test: existing `tests/*.test.ts` + a new `tests/crypto.test.ts`

**Interfaces:**
- Consumes: `logEvent`, `logError`, `generateApiKey` from `@wyrhta/core/lib`. `generateApiKey({ prefix: 'kl_' })` returns `{ raw, hash, prefix }` where `raw` starts with `kl_`.

- [ ] **Step 1: Find current importers (baseline)**

Run: `grep -rn "lib/logger.js\|lib/crypto.js" src`
Expected: `logEvent` used in `src/routes/auth.ts` and `src/middleware/api-key.ts`; `logError` used in `src/middleware/error-handler.ts` (already deleted in Task 3); `generateApiKey`/`hashKey` used in `src/routes/auth.ts` and `src/middleware/api-key.ts`.

- [ ] **Step 2: Write the failing crypto parity test**

Create `tests/crypto.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { generateApiKey } from '@wyrhta/core/lib';

describe('core generateApiKey with kl_ prefix', () => {
  it('produces a kl_ raw key and a stable hash', () => {
    const { raw, hash, prefix } = generateApiKey({ prefix: 'kl_' });
    expect(raw.startsWith('kl_')).toBe(true);
    expect(raw.length).toBe(3 + 64); // 'kl_' + 32-byte hex
    expect(prefix.startsWith('kl_')).toBe(true);
    expect(hash).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test -- tests/crypto.test.ts`
Expected: initially FAIL only if the core import path is wrong; if core is installed it may already PASS. Either way, proceed — this test pins the contract we depend on.

- [ ] **Step 4: Update `src/routes/auth.ts` logger + crypto imports**

Replace:

```ts
import { generateApiKey } from '../lib/crypto.js';
```
```ts
import { logEvent } from '../lib/logger.js';
```

with:

```ts
import { generateApiKey } from '@wyrhta/core/lib';
import { logEvent } from '@wyrhta/core/lib';
```

Update the one `generateApiKey()` call site to pass the prefix:

```ts
const { raw, hash, prefix } = generateApiKey({ prefix: 'kl_' });
```

- [ ] **Step 5: Update `src/middleware/api-key.ts` logger + hash imports (temporary)**

`src/middleware/api-key.ts` currently imports `hashKey` from `../lib/crypto.js` and `logEvent` from `../lib/logger.js`. Core does not export a bare `hashKey`; keep this middleware compiling by inlining the SHA-256 hash and switching the logger import. Replace the imports:

```ts
import { hashKey } from '../lib/crypto.js';
import { logEvent } from '../lib/logger.js';
```

with:

```ts
import { createHash } from 'crypto';
import { logEvent } from '@wyrhta/core/lib';
```

and replace the `const hash = hashKey(raw);` line with:

```ts
const hash = createHash('sha256').update(raw).digest('hex');
```

> This whole middleware file is deleted in Task 7 (replaced by core's auth guards). This step only keeps the tree compiling in between.

- [ ] **Step 6: Delete the local lib files**

```bash
git rm src/lib/logger.ts src/lib/crypto.ts
```

- [ ] **Step 7: Typecheck + full suite**

Run: `npm run typecheck` → Expected: no errors.
Run: `npm test` → Expected: all PASS (including `tests/crypto.test.ts`).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: use @wyrhta/core logger and crypto/api-key"
```

---

## Task 5: Move identity tables to core's schema and generate the migration

Replace KithLedger's in-repo `api_keys` table with core's `users` + `apiKeys` tables, re-exported so drizzle-kit generates the migration. Update the schema barrels and the test truncation order.

**Files:**
- Delete: `src/db/schema/api-keys.ts`
- Modify: `src/db/schema/index.ts`, `src/db/schema/drizzle-schema.ts`, `tests/setup.ts`
- Create: `src/db/migrations/<generated>.sql` (via `db:generate`)
- Test: existing `tests/*.test.ts`

**Interfaces:**
- Consumes: `users`, `apiKeys` Drizzle tables from `@wyrhta/core/identity`.
- Produces: `src/db/schema/index.ts` re-exports `users` and `apiKeys` (so `tests/setup.ts` and `src/identity.ts` import them from the barrel or directly from core — both resolve to the same tables).

- [ ] **Step 1: Delete the local api-keys schema**

```bash
git rm src/db/schema/api-keys.ts
```

- [ ] **Step 2: Update `src/db/schema/index.ts` (ESM `.js` barrel)**

```ts
export * from './people.js';
export * from './interactions.js';
export * from './reminders.js';
export * from './relationships.js';
export { users, apiKeys } from '@wyrhta/core/identity';
```

- [ ] **Step 3: Update `src/db/schema/drizzle-schema.ts` (drizzle-kit CJS barrel)**

```ts
// This file is used by drizzle-kit (no .js extensions on local files)
export * from './people';
export * from './interactions';
export * from './reminders';
export * from './relationships';
export { users, apiKeys } from '@wyrhta/core/identity';
```

- [ ] **Step 4: Update `tests/setup.ts` truncation (FK-safe order: children → api_keys → users)**

```ts
import { beforeAll, beforeEach } from 'vitest';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db } from '../src/db/index.js';
import { people, interactions, reminders, relationships, apiKeys, users } from '../src/db/schema/index.js';

beforeAll(async () => {
  await migrate(db, { migrationsFolder: './src/db/migrations' });
});

beforeEach(async () => {
  // Clean tables in FK-safe order (api_keys references users; domain tables reference people)
  await db.delete(interactions);
  await db.delete(reminders);
  await db.delete(relationships);
  await db.delete(people);
  await db.delete(apiKeys);
  await db.delete(users);
});
```

- [ ] **Step 5: Generate the migration**

Run: `npm run db:generate`
Expected: a new file `src/db/migrations/000X_*.sql` (+ updated `meta/_journal.json` and snapshot) that **CREATE TABLE "users"**, and **ALTER TABLE "api_keys"** to add `user_id` (FK → `users.id`) and `prefix`, and drop the columns not in core's shape (`key_prefix`, `is_active`, `scopes`, `expires_at`). Review the SQL before applying.

- [ ] **Step 6: (Only if upgrading a DB that already has API keys) add a backfill to the generated SQL**

A fresh/empty `api_keys` table needs nothing. If your target DB already holds keys, adding a NOT NULL `user_id` will fail — insert a backfill *before* the `ALTER … SET NOT NULL` in the generated file:

```sql
-- Backfill: attach any pre-existing keys to the seeded admin, copy prefix
UPDATE "api_keys" SET "user_id" = (SELECT id FROM "users" WHERE handle = 'admin' LIMIT 1)
  WHERE "user_id" IS NULL;
UPDATE "api_keys" SET "prefix" = "key_prefix" WHERE "prefix" IS NULL;
```

(The admin row must exist first — Task 6 seeds it. For upgrades, seed before migrating or run the seed SQL manually.)

- [ ] **Step 7: Apply the migration against the test DB**

Run: `npm run docker:up` (if the DB is not already running), then `npm run db:migrate`
Expected: `users` and the reshaped `api_keys` exist. Verify: `docker compose exec db psql -U kith -d kithledger -c '\d users'` shows the columns.

- [ ] **Step 8: Typecheck + full suite**

Run: `npm run typecheck` → Expected: no errors.
Run: `npm test` → Expected: all existing domain tests PASS (they never touch `users`/`api_keys`; `beforeEach` truncation now includes both).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: adopt @wyrhta/core identity schema (users + api_keys)"
```

---

## Task 6: Seed the single admin user at startup

First boot seeds one `admin` user from `ADMIN_PASSWORD`. `seedAdmin()` already exists (Task 1); wire it into `src/index.ts` after migrations and prove idempotency with an integration test.

**Files:**
- Modify: `src/index.ts`
- Test: `tests/seed-admin.test.ts`

**Interfaces:**
- Consumes: `seedAdmin`, `getAdminUser`, `ADMIN_HANDLE` from `src/identity.ts`.

- [ ] **Step 1: Write the failing seed test**

Create `tests/seed-admin.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { users } from '../src/db/schema/index.js';
import { seedAdmin, getAdminUser, ADMIN_HANDLE } from '../src/identity.js';

describe('seedAdmin', () => {
  it('creates exactly one admin user and is idempotent', async () => {
    await seedAdmin();
    await seedAdmin(); // second call must be a no-op

    const rows = await db.select().from(users).where(eq(users.handle, ADMIN_HANDLE));
    expect(rows.length).toBe(1);
    expect(rows[0]!.role).toBe('admin');

    const admin = await getAdminUser();
    expect(admin.handle).toBe(ADMIN_HANDLE);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- tests/seed-admin.test.ts`
Expected: FAIL — no admin row after `beforeEach` truncation until `seedAdmin()` is proven to insert exactly one. (If core's `createUser` signature differs from Assumption in Global Constraints, this is where it surfaces — reconcile `src/identity.ts`.)

- [ ] **Step 3: Wire `seedAdmin()` into `src/index.ts`**

```ts
import { serve } from '@hono/node-server';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db } from './db/index.js';
import { createApp } from './app.js';
import { config } from './config/env.js';
import { seedAdmin } from './identity.js';

async function main() {
  console.log('Running database migrations...');
  await migrate(db, { migrationsFolder: './src/db/migrations' });
  console.log('Migrations complete.');

  console.log('Seeding admin user (idempotent)...');
  await seedAdmin();
  console.log('Admin user ready.');

  const app = createApp();

  serve(
    {
      fetch: app.fetch,
      port: config.port,
    },
    (info) => {
      console.log(`KithLedger API running on http://localhost:${info.port}`);
    }
  );
}

main().catch((err) => {
  console.error('Fatal error during startup:', err);
  process.exit(1);
});
```

- [ ] **Step 4: Run the seed test**

Run: `npm test -- tests/seed-admin.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite + typecheck**

Run: `npm run typecheck` → no errors. Run: `npm test` → all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts tests/seed-admin.test.ts
git commit -m "feat: seed single admin user from ADMIN_PASSWORD at startup"
```

---

## Task 7: Rebuild `/auth` routes on core identity and swap route guards

`POST /auth/token` authenticates the seeded admin via core identity and returns a core-issued JWT (behavior unchanged: still accepts `{ password }`). `/auth/keys*` uses core identity keys CRUD scoped to the admin user. All domain routes swap their guard import from the local middleware to `src/identity.ts`. Delete the now-dead auth middleware.

**Files:**
- Modify: `src/routes/auth.ts` (rewrite), `src/routes/index.ts`, `src/routes/people.ts`, `src/routes/interactions.ts`, `src/routes/reminders.ts`, `src/routes/relationships.ts`
- Delete: `src/middleware/auth.ts`, `src/middleware/api-key.ts`, `src/middleware/jwt.ts`
- Test: `tests/auth.test.ts` (new) + existing domain tests

**Interfaces:**
- Consumes: `identity`, `requireAuth`, `requireJwt`, `getAdminUser`, `ADMIN_EMAIL` from `src/identity.ts`; `ok`, `err` from `@wyrhta/core/http`; `logEvent` from `@wyrhta/core/lib`; `rateLimit` from `@wyrhta/core/http/middleware`.

- [ ] **Step 1: Write the failing auth integration test**

Create `tests/auth.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createApp } from '../src/app.js';
import { seedAdmin } from '../src/identity.js';
import { config } from '../src/config/env.js';

const app = createApp();

beforeEach(async () => {
  await seedAdmin(); // beforeEach truncation wipes users; reseed for auth flow
});

describe('POST /api/v1/auth/token', () => {
  it('issues a JWT for the correct admin password', async () => {
    const res = await app.request('/api/v1/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: config.adminPassword }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { token: string; expires_in: number } };
    expect(body.data.token.split('.').length).toBe(3); // JWT
    expect(body.data.expires_in).toBeGreaterThan(0);
  });

  it('rejects a wrong password with 401', async () => {
    const res = await app.request('/api/v1/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'definitely-wrong' }),
    });
    expect(res.status).toBe(401);
  });
});

describe('API key lifecycle (JWT-only routes)', () => {
  async function jwt() {
    const res = await app.request('/api/v1/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: config.adminPassword }),
    });
    return (await res.json() as { data: { token: string } }).data.token;
  }

  it('creates, lists, uses, and revokes a kl_ key', async () => {
    const token = await jwt();
    const authJwt = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    const createRes = await app.request('/api/v1/auth/keys', {
      method: 'POST', headers: authJwt, body: JSON.stringify({ name: 'agent' }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json() as { data: { key: string; id: string } }).data;
    expect(created.key.startsWith('kl_')).toBe(true);

    // The raw key authenticates a protected domain route
    const useRes = await app.request('/api/v1/people', {
      headers: { Authorization: `Bearer ${created.key}` },
    });
    expect(useRes.status).toBe(200);

    // Listing is JWT-only; the kl_ key must be rejected there
    const listWithKey = await app.request('/api/v1/auth/keys', {
      headers: { Authorization: `Bearer ${created.key}` },
    });
    expect(listWithKey.status).toBe(401);

    const listRes = await app.request('/api/v1/auth/keys', { headers: authJwt });
    expect(listRes.status).toBe(200);

    const delRes = await app.request(`/api/v1/auth/keys/${created.id}`, {
      method: 'DELETE', headers: authJwt,
    });
    expect(delRes.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- tests/auth.test.ts`
Expected: FAIL — the current `/auth/token` checks `ADMIN_PASSWORD` directly and issues an ad-hoc token; keys are stored in the old table shape. Rewrite next.

- [ ] **Step 3: Rewrite `src/routes/auth.ts`**

```ts
import { Hono } from 'hono';
import { z } from 'zod';
import { ok, err } from '@wyrhta/core/http';
import { rateLimit } from '@wyrhta/core/http/middleware';
import { logEvent } from '@wyrhta/core/lib';
import { identity, requireJwt, getAdminUser, ADMIN_EMAIL } from '../identity.js';

export const authRouter = new Hono();

const tokenSchema = z.object({ password: z.string() });
const createKeySchema = z.object({ name: z.string().min(1) });

function getIp(c: Parameters<typeof rateLimit>[0]): string {
  return (
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    c.req.header('cf-connecting-ip') ??
    'unknown'
  );
}

authRouter.post('/token', rateLimit, async (c) => {
  const body = tokenSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);

  const ip = getIp(c);
  const requestId = c.get('requestId');

  const user = await identity.authenticate({ email: ADMIN_EMAIL, password: body.data.password });
  if (!user) {
    logEvent({ event: 'auth.token.failure', ip, success: false, request_id: requestId });
    return err(c, 'UNAUTHORIZED', 'Invalid password', 401);
  }

  const { token, expiresIn } = await identity.issueToken(user);
  logEvent({ event: 'auth.token.success', ip, success: true, request_id: requestId });
  return ok(c, { token, expires_in: expiresIn });
});

authRouter.get('/keys', requireJwt, async (c) => {
  const admin = await getAdminUser();
  const rows = await identity.listApiKeys(admin.id);
  return ok(c, rows);
});

authRouter.post('/keys', requireJwt, async (c) => {
  const body = createKeySchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);

  const admin = await getAdminUser();
  const key = await identity.createApiKey({ userId: admin.id, name: body.data.name });

  logEvent({ event: 'auth.key.created', key_id: key.id, key_name: key.name, request_id: c.get('requestId') });

  return ok(
    c,
    { id: key.id, name: key.name, key: key.raw, keyPrefix: key.prefix, createdAt: key.createdAt },
    undefined,
    201
  );
});

authRouter.delete('/keys/:id', requireJwt, async (c) => {
  const revoked = await identity.revokeApiKey(c.req.param('id'));
  if (!revoked) return err(c, 'NOT_FOUND', 'API key not found', 404);
  logEvent({ event: 'auth.key.revoked', key_id: revoked.id, request_id: c.get('requestId') });
  return ok(c, { id: revoked.id, isActive: false });
});
```

- [ ] **Step 4: Swap the guard import in every domain route**

In `src/routes/people.ts`, `interactions.ts`, `reminders.ts`, and `relationships.ts`, replace:

```ts
import { requireAuth } from '../middleware/auth.js';
```

with:

```ts
import { requireAuth } from '../identity.js';
```

The `router.use('*', requireAuth)` line in each file stays unchanged.

- [ ] **Step 5: Swap the guard import in `src/routes/index.ts`**

Replace `import { requireAuth } from '../middleware/auth.js';` with:

```ts
import { requireAuth } from '../identity.js';
```

The nested `app.get('/api/v1/people/:id/graph', requireAuth, …)` handler stays unchanged.

- [ ] **Step 6: Delete the dead auth middleware**

```bash
git rm src/middleware/auth.ts src/middleware/api-key.ts src/middleware/jwt.ts
```

- [ ] **Step 7: Typecheck + run auth test + full suite (acceptance)**

Run: `npm run typecheck` → Expected: no errors.
Run: `npm test -- tests/auth.test.ts` → Expected: PASS.
Run: `npm test` → Expected: **all** tests PASS, including the four unchanged domain suites (proves Part-1 acceptance and Assumption A1).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: migrate auth to @wyrhta/core identity (single-user admin, kl_ keys)"
```

---

# PART 2 — MCP Server

## Task 8: MCP auth adapter (`kl_` key → admin user)

Build the `McpAuthAdapter` that validates an incoming `kl_` API key via core identity and resolves it to `{ userId, role }`, logging the call. Any non-`kl_` or invalid credential is denied.

**Files:**
- Create: `src/mcp/auth.ts`
- Test: `tests/mcp.auth.test.ts`

**Interfaces:**
- Consumes: `identity` from `src/identity.ts`; `getAdminUser` from `src/identity.ts`; `logEvent` from `@wyrhta/core/lib`.
- Produces: `mcpAuthAdapter: McpAuthAdapter` — `(credential: string) => Promise<{ userId: string; role: string } | null>`.

- [ ] **Step 1: Write the failing adapter test**

Create `tests/mcp.auth.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { seedAdmin, identity, getAdminUser } from '../src/identity.js';
import { mcpAuthAdapter } from '../src/mcp/auth.js';

beforeEach(async () => {
  await seedAdmin();
});

describe('mcpAuthAdapter', () => {
  it('resolves a valid kl_ key to the admin user + role', async () => {
    const admin = await getAdminUser();
    const key = await identity.createApiKey({ userId: admin.id, name: 'mcp' });

    const result = await mcpAuthAdapter(key.raw);
    expect(result).not.toBeNull();
    expect(result!.userId).toBe(admin.id);
    expect(result!.role).toBe('admin');
  });

  it('denies an invalid key', async () => {
    expect(await mcpAuthAdapter('kl_deadbeef')).toBeNull();
  });

  it('denies a non-kl_ credential', async () => {
    expect(await mcpAuthAdapter('eyJhbGciOi.fake.jwt')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- tests/mcp.auth.test.ts`
Expected: FAIL — `Cannot find module '../src/mcp/auth.js'`.

- [ ] **Step 3: Create `src/mcp/auth.ts`**

```ts
import type { McpAuthAdapter } from '@wyrhta/core/mcp';
import { logEvent } from '@wyrhta/core/lib';
import { identity, getAdminUser } from '../identity.js';

/**
 * MCP credential → user resolver. KithLedger is single-user: any valid kl_ key
 * belongs to the admin. Mirrors the REST api-key auth path.
 */
export const mcpAuthAdapter: McpAuthAdapter = async (credential: string) => {
  if (!credential || !credential.startsWith('kl_')) {
    logEvent({ event: 'mcp.auth.rejected', auth_type: 'api_key', success: false });
    return null;
  }

  const validated = await identity.validateApiKey(credential);
  if (!validated) {
    logEvent({ event: 'mcp.auth.rejected', auth_type: 'api_key', success: false });
    return null;
  }

  const admin = await getAdminUser();
  logEvent({
    event: 'mcp.auth.accepted',
    auth_type: 'api_key',
    success: true,
    key_id: validated.keyId,
    key_name: validated.name,
  });
  return { userId: admin.id, role: admin.role };
};
```

- [ ] **Step 4: Run the test + typecheck**

Run: `npm test -- tests/mcp.auth.test.ts` → Expected: PASS.
Run: `npm run typecheck` → Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/auth.ts tests/mcp.auth.test.ts
git commit -m "feat: MCP auth adapter resolving kl_ key to admin user"
```

---

## Task 9: `kith.*` people tools

Register the five people tools as `McpTool`s calling `services/people.ts` and `services/relationships.ts` (graph) directly. Reuse the existing Zod validators for input schemas. Establish the shared tool-result conventions used by all later tool tasks.

**Files:**
- Create: `src/mcp/tools/people.ts`
- Test: `tests/mcp.people.test.ts`

**Interfaces:**
- Consumes: `McpTool`, `McpContext` from `@wyrhta/core/mcp`; `* as peopleService` from `../../services/people.js`; `getPersonGraph` from `../../services/relationships.js`; `createPersonSchema`, `updatePersonSchema`, `listPeopleQuerySchema` from `../../validators/people.js`.
- Produces: `peopleTools: McpTool[]` with names `kith.list_people`, `kith.get_person`, `kith.create_person`, `kith.update_person`, `kith.get_person_graph`.
- **Result conventions (used by ALL tool tasks):**
  - list tools return `{ items, total, limit, offset }` (parity with REST `data` + `meta`).
  - get/create/update tools return the row object (parity with REST `data`).
  - `get_person_graph` returns `{ nodes, edges }`.
  - Not-found → tool throws `Error('NOT_FOUND')`; the scaffold surfaces it as an MCP error (parity with a REST 404).

- [ ] **Step 1: Write the failing people-tools test**

Create `tests/mcp.people.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { McpContext } from '@wyrhta/core/mcp';
import { peopleTools } from '../src/mcp/tools/people.js';

const ctx: McpContext = { userId: 'admin', role: 'admin', requestId: 'test' };

function tool(name: string) {
  const t = peopleTools.find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} not registered`);
  return t;
}

describe('kith.* people tools', () => {
  it('registers all five tools with the kith. namespace', () => {
    expect(peopleTools.map((t) => t.name).sort()).toEqual([
      'kith.create_person',
      'kith.get_person',
      'kith.get_person_graph',
      'kith.list_people',
      'kith.update_person',
    ]);
  });

  it('create_person then get_person round-trips (parity with REST data)', async () => {
    const created = await tool('kith.create_person').handler(ctx, { name: 'Alice', tags: ['friend'] }) as { id: string; name: string };
    expect(created.name).toBe('Alice');

    const fetched = await tool('kith.get_person').handler(ctx, { id: created.id }) as { name: string };
    expect(fetched.name).toBe('Alice');
  });

  it('list_people returns the list envelope shape', async () => {
    await tool('kith.create_person').handler(ctx, { name: 'Bob' });
    const res = await tool('kith.list_people').handler(ctx, {}) as { items: unknown[]; total: number; limit: number; offset: number };
    expect(Array.isArray(res.items)).toBe(true);
    expect(res.items.length).toBeGreaterThan(0);
    expect(typeof res.total).toBe('number');
  });

  it('update_person changes a field', async () => {
    const created = await tool('kith.create_person').handler(ctx, { name: 'Carol' }) as { id: string };
    const updated = await tool('kith.update_person').handler(ctx, { id: created.id, name: 'Caroline' }) as { name: string };
    expect(updated.name).toBe('Caroline');
  });

  it('get_person throws NOT_FOUND for an unknown id', async () => {
    await expect(
      tool('kith.get_person').handler(ctx, { id: '00000000-0000-0000-0000-000000000000' })
    ).rejects.toThrow('NOT_FOUND');
  });

  it('get_person_graph returns nodes and edges', async () => {
    const a = await tool('kith.create_person').handler(ctx, { name: 'Root' }) as { id: string };
    const res = await tool('kith.get_person_graph').handler(ctx, { id: a.id, depth: 1 }) as { nodes: unknown[]; edges: unknown[] };
    expect(Array.isArray(res.nodes)).toBe(true);
    expect(Array.isArray(res.edges)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- tests/mcp.people.test.ts`
Expected: FAIL — `Cannot find module '../src/mcp/tools/people.js'`.

- [ ] **Step 3: Create `src/mcp/tools/people.ts`**

```ts
import { z } from 'zod';
import type { McpTool } from '@wyrhta/core/mcp';
import * as peopleService from '../../services/people.js';
import { getPersonGraph } from '../../services/relationships.js';
import { createPersonSchema, updatePersonSchema, listPeopleQuerySchema } from '../../validators/people.js';

const idSchema = z.object({ id: z.string().uuid() });
const updateInput = z.object({ id: z.string().uuid() }).and(updatePersonSchema);
const graphInput = z.object({
  id: z.string().uuid(),
  depth: z.coerce.number().int().min(1).max(3).optional().default(1),
});

export const peopleTools: McpTool[] = [
  {
    name: 'kith.list_people',
    description: 'List people, optionally filtered by q, tags (comma-separated), or birthday_month.',
    inputSchema: listPeopleQuerySchema,
    handler: async (_ctx, input) => {
      const query = listPeopleQuerySchema.parse(input ?? {});
      const { rows, total, limit, offset } = await peopleService.listPeople(query);
      return { items: rows, total, limit, offset };
    },
  },
  {
    name: 'kith.get_person',
    description: 'Get a single person by id.',
    inputSchema: idSchema,
    handler: async (_ctx, input) => {
      const { id } = idSchema.parse(input);
      const person = await peopleService.getPerson(id);
      if (!person) throw new Error('NOT_FOUND');
      return person;
    },
  },
  {
    name: 'kith.create_person',
    description: 'Create a person.',
    inputSchema: createPersonSchema,
    handler: async (_ctx, input) => {
      const data = createPersonSchema.parse(input);
      return peopleService.createPerson(data);
    },
  },
  {
    name: 'kith.update_person',
    description: 'Update fields on an existing person.',
    inputSchema: updateInput,
    handler: async (_ctx, input) => {
      const { id, ...rest } = updateInput.parse(input);
      const data = updatePersonSchema.parse(rest);
      const person = await peopleService.updatePerson(id, data);
      if (!person) throw new Error('NOT_FOUND');
      return person;
    },
  },
  {
    name: 'kith.get_person_graph',
    description: 'Get the ego network (nodes + edges) around a person up to a given depth (1-3).',
    inputSchema: graphInput,
    handler: async (_ctx, input) => {
      const { id, depth } = graphInput.parse(input);
      const graph = await getPersonGraph(id, depth);
      if (!graph) throw new Error('NOT_FOUND');
      return graph;
    },
  },
];
```

- [ ] **Step 4: Run the test + typecheck**

Run: `npm test -- tests/mcp.people.test.ts` → Expected: PASS.
Run: `npm run typecheck` → Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tools/people.ts tests/mcp.people.test.ts
git commit -m "feat: MCP kith.* people tools calling the people service directly"
```

---

## Task 10: `kith.*` interactions tools

Register `list_interactions` and `log_interaction` calling `services/interactions.ts`. `log_interaction` reuses the create validator and maps the service's `PERSON_NOT_FOUND` to a thrown `NOT_FOUND` (parity with the REST 404).

**Files:**
- Create: `src/mcp/tools/interactions.ts`
- Test: `tests/mcp.interactions.test.ts`

**Interfaces:**
- Consumes: `McpTool` from `@wyrhta/core/mcp`; `* as interactionsService` from `../../services/interactions.js`; `createInteractionSchema`, `listInteractionsQuerySchema` from `../../validators/interactions.js`. For test setup, `peopleTools` from `./tools/people.js`.
- Produces: `interactionTools: McpTool[]` with names `kith.list_interactions`, `kith.log_interaction`.

- [ ] **Step 1: Write the failing interactions-tools test**

Create `tests/mcp.interactions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { McpContext } from '@wyrhta/core/mcp';
import { interactionTools } from '../src/mcp/tools/interactions.js';
import { peopleTools } from '../src/mcp/tools/people.js';

const ctx: McpContext = { userId: 'admin', role: 'admin', requestId: 'test' };
const tool = (list: typeof interactionTools, name: string) => {
  const t = list.find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} not registered`);
  return t;
};

async function makePerson() {
  const p = await tool(peopleTools, 'kith.create_person').handler(ctx, { name: 'Dana' }) as { id: string };
  return p.id;
}

describe('kith.* interactions tools', () => {
  it('registers the two tools', () => {
    expect(interactionTools.map((t) => t.name).sort()).toEqual(['kith.list_interactions', 'kith.log_interaction']);
  });

  it('log_interaction then list_interactions round-trips', async () => {
    const personId = await makePerson();
    const logged = await tool(interactionTools, 'kith.log_interaction').handler(ctx, {
      personId, occurredAt: new Date().toISOString(), type: 'call', channel: 'phone',
    }) as { id: string; type: string };
    expect(logged.type).toBe('call');

    const res = await tool(interactionTools, 'kith.list_interactions').handler(ctx, { person_id: personId }) as { items: unknown[]; total: number };
    expect(res.total).toBeGreaterThanOrEqual(1);
    expect(res.items.length).toBeGreaterThanOrEqual(1);
  });

  it('log_interaction throws NOT_FOUND for a missing person', async () => {
    await expect(
      tool(interactionTools, 'kith.log_interaction').handler(ctx, {
        personId: '00000000-0000-0000-0000-000000000000', occurredAt: new Date().toISOString(), type: 'call',
      })
    ).rejects.toThrow('NOT_FOUND');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- tests/mcp.interactions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/mcp/tools/interactions.ts`**

```ts
import type { McpTool } from '@wyrhta/core/mcp';
import * as interactionsService from '../../services/interactions.js';
import { createInteractionSchema, listInteractionsQuerySchema } from '../../validators/interactions.js';

export const interactionTools: McpTool[] = [
  {
    name: 'kith.list_interactions',
    description: 'List interactions, optionally filtered by person_id, type, from, to.',
    inputSchema: listInteractionsQuerySchema,
    handler: async (_ctx, input) => {
      const query = listInteractionsQuerySchema.parse(input ?? {});
      const { rows, total, limit, offset } = await interactionsService.listInteractions(query);
      return { items: rows, total, limit, offset };
    },
  },
  {
    name: 'kith.log_interaction',
    description: 'Log an interaction with a person.',
    inputSchema: createInteractionSchema,
    handler: async (_ctx, input) => {
      const data = createInteractionSchema.parse(input);
      try {
        return await interactionsService.createInteraction(data);
      } catch (e: unknown) {
        if (e instanceof Error && e.message === 'PERSON_NOT_FOUND') throw new Error('NOT_FOUND');
        throw e;
      }
    },
  },
];
```

- [ ] **Step 4: Run the test + typecheck**

Run: `npm test -- tests/mcp.interactions.test.ts` → Expected: PASS.
Run: `npm run typecheck` → Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tools/interactions.ts tests/mcp.interactions.test.ts
git commit -m "feat: MCP kith.* interactions tools"
```

---

## Task 11: `kith.*` reminders tools

Register `list_reminders`, `create_reminder`, `complete_reminder` (recurrence-aware), `snooze_reminder`, calling `services/reminders.ts`. `complete_reminder` returns `{ updated, next }` exactly as the service does.

**Files:**
- Create: `src/mcp/tools/reminders.ts`
- Test: `tests/mcp.reminders.test.ts`

**Interfaces:**
- Consumes: `McpTool` from `@wyrhta/core/mcp`; `* as remindersService` from `../../services/reminders.js`; `createReminderSchema`, `listRemindersQuerySchema`, `snoozeReminderSchema` from `../../validators/reminders.js`; `peopleTools` (test only).
- Produces: `reminderTools: McpTool[]` with names `kith.list_reminders`, `kith.create_reminder`, `kith.complete_reminder`, `kith.snooze_reminder`.

- [ ] **Step 1: Write the failing reminders-tools test**

Create `tests/mcp.reminders.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { McpContext } from '@wyrhta/core/mcp';
import { reminderTools } from '../src/mcp/tools/reminders.js';
import { peopleTools } from '../src/mcp/tools/people.js';

const ctx: McpContext = { userId: 'admin', role: 'admin', requestId: 'test' };
const tool = <T extends { name: string; handler: Function }>(list: T[], name: string) => {
  const t = list.find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} not registered`);
  return t;
};

async function makePerson() {
  const p = await tool(peopleTools, 'kith.create_person').handler(ctx, { name: 'Erin' }) as { id: string };
  return p.id;
}

describe('kith.* reminders tools', () => {
  it('registers the four tools', () => {
    expect(reminderTools.map((t) => t.name).sort()).toEqual([
      'kith.complete_reminder', 'kith.create_reminder', 'kith.list_reminders', 'kith.snooze_reminder',
    ]);
  });

  it('create + list round-trips', async () => {
    const personId = await makePerson();
    await tool(reminderTools, 'kith.create_reminder').handler(ctx, {
      personId, dueAt: new Date().toISOString(), title: 'Call Erin',
    });
    const res = await tool(reminderTools, 'kith.list_reminders').handler(ctx, { person_id: personId }) as { items: unknown[]; total: number };
    expect(res.total).toBe(1);
  });

  it('complete_reminder on a recurring reminder returns updated + next', async () => {
    const personId = await makePerson();
    const created = await tool(reminderTools, 'kith.create_reminder').handler(ctx, {
      personId, dueAt: new Date().toISOString(), title: 'Monthly ping', recurrence: 'P1M',
    }) as { id: string };

    const result = await tool(reminderTools, 'kith.complete_reminder').handler(ctx, { id: created.id }) as {
      updated: { status: string }; next: { id: string } | null;
    };
    expect(result.updated.status).toBe('done');
    expect(result.next).not.toBeNull();
  });

  it('complete_reminder throws NOT_FOUND for a missing reminder', async () => {
    await expect(
      tool(reminderTools, 'kith.complete_reminder').handler(ctx, { id: '00000000-0000-0000-0000-000000000000' })
    ).rejects.toThrow('NOT_FOUND');
  });

  it('snooze_reminder sets snoozed status', async () => {
    const personId = await makePerson();
    const created = await tool(reminderTools, 'kith.create_reminder').handler(ctx, {
      personId, dueAt: new Date().toISOString(), title: 'Snoozable',
    }) as { id: string };
    const snoozed = await tool(reminderTools, 'kith.snooze_reminder').handler(ctx, {
      id: created.id, snooze_until: new Date(Date.now() + 86400000).toISOString(),
    }) as { status: string };
    expect(snoozed.status).toBe('snoozed');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- tests/mcp.reminders.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/mcp/tools/reminders.ts`**

```ts
import { z } from 'zod';
import type { McpTool } from '@wyrhta/core/mcp';
import * as remindersService from '../../services/reminders.js';
import { createReminderSchema, listRemindersQuerySchema, snoozeReminderSchema } from '../../validators/reminders.js';

const idSchema = z.object({ id: z.string().uuid() });
const snoozeInput = z.object({ id: z.string().uuid() }).and(snoozeReminderSchema);

export const reminderTools: McpTool[] = [
  {
    name: 'kith.list_reminders',
    description: 'List reminders, optionally filtered by person_id, status, overdue.',
    inputSchema: listRemindersQuerySchema,
    handler: async (_ctx, input) => {
      const query = listRemindersQuerySchema.parse(input ?? {});
      const { rows, total, limit, offset } = await remindersService.listReminders(query);
      return { items: rows, total, limit, offset };
    },
  },
  {
    name: 'kith.create_reminder',
    description: 'Create a reminder for a person; recurrence is an ISO 8601 duration (e.g. P1M).',
    inputSchema: createReminderSchema,
    handler: async (_ctx, input) => {
      const data = createReminderSchema.parse(input);
      try {
        return await remindersService.createReminder(data);
      } catch (e: unknown) {
        if (e instanceof Error && e.message === 'PERSON_NOT_FOUND') throw new Error('NOT_FOUND');
        throw e;
      }
    },
  },
  {
    name: 'kith.complete_reminder',
    description: 'Mark a reminder done; if recurring, creates the next occurrence and returns it as `next`.',
    inputSchema: idSchema,
    handler: async (_ctx, input) => {
      const { id } = idSchema.parse(input);
      const result = await remindersService.completeReminder(id);
      if (!result) throw new Error('NOT_FOUND');
      return result;
    },
  },
  {
    name: 'kith.snooze_reminder',
    description: 'Snooze a reminder until a given ISO 8601 timestamp.',
    inputSchema: snoozeInput,
    handler: async (_ctx, input) => {
      const { id, snooze_until } = snoozeInput.parse(input);
      const reminder = await remindersService.snoozeReminder(id, snooze_until);
      if (!reminder) throw new Error('NOT_FOUND');
      return reminder;
    },
  },
];
```

- [ ] **Step 4: Run the test + typecheck**

Run: `npm test -- tests/mcp.reminders.test.ts` → Expected: PASS.
Run: `npm run typecheck` → Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tools/reminders.ts tests/mcp.reminders.test.ts
git commit -m "feat: MCP kith.* reminders tools (recurrence-aware complete)"
```

---

## Task 12: `kith.*` relationships tools

Register `list_relationships` and `create_relationship` calling `services/relationships.ts`. Map the service's `FROM_PERSON_NOT_FOUND`/`TO_PERSON_NOT_FOUND` to `NOT_FOUND` and `RELATIONSHIP_EXISTS` (Postgres `23505`) to `CONFLICT` (parity with the REST 404/409).

**Files:**
- Create: `src/mcp/tools/relationships.ts`
- Test: `tests/mcp.relationships.test.ts`

**Interfaces:**
- Consumes: `McpTool` from `@wyrhta/core/mcp`; `* as relationshipsService` from `../../services/relationships.js`; `createRelationshipSchema`, `listRelationshipsQuerySchema` from `../../validators/relationships.js`; `peopleTools` (test only).
- Produces: `relationshipTools: McpTool[]` with names `kith.list_relationships`, `kith.create_relationship`.

- [ ] **Step 1: Write the failing relationships-tools test**

Create `tests/mcp.relationships.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { McpContext } from '@wyrhta/core/mcp';
import { relationshipTools } from '../src/mcp/tools/relationships.js';
import { peopleTools } from '../src/mcp/tools/people.js';

const ctx: McpContext = { userId: 'admin', role: 'admin', requestId: 'test' };
const tool = <T extends { name: string; handler: Function }>(list: T[], name: string) => {
  const t = list.find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} not registered`);
  return t;
};

async function makePerson(name: string) {
  const p = await tool(peopleTools, 'kith.create_person').handler(ctx, { name }) as { id: string };
  return p.id;
}

describe('kith.* relationships tools', () => {
  it('registers the two tools', () => {
    expect(relationshipTools.map((t) => t.name).sort()).toEqual(['kith.create_relationship', 'kith.list_relationships']);
  });

  it('create then list round-trips (mutual link visible from both people)', async () => {
    const a = await makePerson('Fred');
    const b = await makePerson('Gina');
    await tool(relationshipTools, 'kith.create_relationship').handler(ctx, {
      fromPersonId: a, toPersonId: b, type: 'friend', isMutual: true,
    });

    const fromA = await tool(relationshipTools, 'kith.list_relationships').handler(ctx, { person_id: a }) as { total: number };
    const fromB = await tool(relationshipTools, 'kith.list_relationships').handler(ctx, { person_id: b }) as { total: number };
    expect(fromA.total).toBe(1);
    expect(fromB.total).toBe(1); // mutual link surfaces from the other side too
  });

  it('duplicate link throws CONFLICT', async () => {
    const a = await makePerson('Hank');
    const b = await makePerson('Ivy');
    const payload = { fromPersonId: a, toPersonId: b, type: 'friend' as const };
    await tool(relationshipTools, 'kith.create_relationship').handler(ctx, payload);
    await expect(
      tool(relationshipTools, 'kith.create_relationship').handler(ctx, payload)
    ).rejects.toThrow('CONFLICT');
  });

  it('missing person throws NOT_FOUND', async () => {
    const a = await makePerson('Jane');
    await expect(
      tool(relationshipTools, 'kith.create_relationship').handler(ctx, {
        fromPersonId: a, toPersonId: '00000000-0000-0000-0000-000000000000', type: 'friend',
      })
    ).rejects.toThrow('NOT_FOUND');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- tests/mcp.relationships.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/mcp/tools/relationships.ts`**

```ts
import type { McpTool } from '@wyrhta/core/mcp';
import * as relationshipsService from '../../services/relationships.js';
import { createRelationshipSchema, listRelationshipsQuerySchema } from '../../validators/relationships.js';

export const relationshipTools: McpTool[] = [
  {
    name: 'kith.list_relationships',
    description: 'List relationships, optionally filtered by person_id or type.',
    inputSchema: listRelationshipsQuerySchema,
    handler: async (_ctx, input) => {
      const query = listRelationshipsQuerySchema.parse(input ?? {});
      const { rows, total, limit, offset } = await relationshipsService.listRelationships(query);
      return { items: rows, total, limit, offset };
    },
  },
  {
    name: 'kith.create_relationship',
    description: 'Create a relationship between two people (defaults to mutual).',
    inputSchema: createRelationshipSchema,
    handler: async (_ctx, input) => {
      const data = createRelationshipSchema.parse(input);
      try {
        return await relationshipsService.createRelationship(data);
      } catch (e: unknown) {
        if (e instanceof Error) {
          if (e.message === 'FROM_PERSON_NOT_FOUND' || e.message === 'TO_PERSON_NOT_FOUND') throw new Error('NOT_FOUND');
          if (e.message === 'RELATIONSHIP_EXISTS') throw new Error('CONFLICT');
        }
        throw e;
      }
    },
  },
];
```

- [ ] **Step 4: Run the test + typecheck**

Run: `npm test -- tests/mcp.relationships.test.ts` → Expected: PASS.
Run: `npm run typecheck` → Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tools/relationships.ts tests/mcp.relationships.test.ts
git commit -m "feat: MCP kith.* relationships tools"
```

---

## Task 13: Assemble the registry, server, and stdio entrypoint

Combine all tool arrays into one registry, stand up the server via core's `createMcpServer` with the auth adapter, add a runnable entrypoint (migrations + seed + connect), and a `mcp` npm script. Prove the full registry (13 tools) and end-to-end auth enforcement.

**Files:**
- Create: `src/mcp/registry.ts`, `src/mcp/server.ts`, `src/mcp/index.ts`
- Modify: `package.json` (add `mcp` script)
- Test: `tests/mcp.registry.test.ts`

**Interfaces:**
- Consumes: `peopleTools`, `interactionTools`, `reminderTools`, `relationshipTools` (from `./tools/*`); `createMcpServer` from `@wyrhta/core/mcp`; `mcpAuthAdapter` from `./auth.js`.
- Produces: `kithTools: McpTool[]` (all 13); `createKithMcpServer()` returning the core server; `src/mcp/index.ts` as the stdio entrypoint.

- [ ] **Step 1: Write the failing registry/auth test**

Create `tests/mcp.registry.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { kithTools } from '../src/mcp/registry.js';
import { mcpAuthAdapter } from '../src/mcp/auth.js';
import { seedAdmin, identity, getAdminUser } from '../src/identity.js';

beforeEach(async () => {
  await seedAdmin();
});

describe('MCP registry', () => {
  it('exposes all 13 kith.* tools', () => {
    expect(kithTools.map((t) => t.name).sort()).toEqual([
      'kith.complete_reminder',
      'kith.create_person',
      'kith.create_reminder',
      'kith.create_relationship',
      'kith.get_person',
      'kith.get_person_graph',
      'kith.list_interactions',
      'kith.list_people',
      'kith.list_reminders',
      'kith.list_relationships',
      'kith.log_interaction',
      'kith.snooze_reminder',
      'kith.update_person',
    ]);
  });

  it('every tool name is kith.-namespaced and unique', () => {
    const names = kithTools.map((t) => t.name);
    expect(names.every((n) => n.startsWith('kith.'))).toBe(true);
    expect(new Set(names).size).toBe(names.length);
  });

  it('auth adapter admits a valid kl_ key and rejects garbage (enforcement parity with REST)', async () => {
    const admin = await getAdminUser();
    const key = await identity.createApiKey({ userId: admin.id, name: 'mcp-e2e' });
    expect(await mcpAuthAdapter(key.raw)).not.toBeNull();
    expect(await mcpAuthAdapter('kl_not-a-real-key')).toBeNull();
    expect(await mcpAuthAdapter('')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- tests/mcp.registry.test.ts`
Expected: FAIL — `Cannot find module '../src/mcp/registry.js'`.

- [ ] **Step 3: Create `src/mcp/registry.ts`**

```ts
import type { McpTool } from '@wyrhta/core/mcp';
import { peopleTools } from './tools/people.js';
import { interactionTools } from './tools/interactions.js';
import { reminderTools } from './tools/reminders.js';
import { relationshipTools } from './tools/relationships.js';

/** The complete KithLedger MCP tool set, all namespaced `kith.*`. */
export const kithTools: McpTool[] = [
  ...peopleTools,
  ...interactionTools,
  ...reminderTools,
  ...relationshipTools,
];
```

- [ ] **Step 4: Create `src/mcp/server.ts`**

```ts
import { createMcpServer } from '@wyrhta/core/mcp';
import { kithTools } from './registry.js';
import { mcpAuthAdapter } from './auth.js';

/** Assemble KithLedger's MCP server: the kith.* registry behind the kl_-key auth adapter. */
export function createKithMcpServer() {
  return createMcpServer(kithTools, mcpAuthAdapter);
}
```

- [ ] **Step 5: Create `src/mcp/index.ts` (stdio entrypoint)**

```ts
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db } from '../db/index.js';
import { seedAdmin } from '../identity.js';
import { createKithMcpServer } from './server.js';

async function main() {
  await migrate(db, { migrationsFolder: './src/db/migrations' });
  await seedAdmin();
  const server = createKithMcpServer();
  await server.connect(); // stdio transport
}

main().catch((err) => {
  console.error('Fatal error starting KithLedger MCP server:', err);
  process.exit(1);
});
```

- [ ] **Step 6: Add the `mcp` script to `package.json`**

Add this line to `"scripts"` (after `"dev:api"`):

```jsonc
    "mcp": "tsx src/mcp/index.ts",
```

- [ ] **Step 7: Run the registry test + typecheck + full suite**

Run: `npm test -- tests/mcp.registry.test.ts` → Expected: PASS.
Run: `npm run typecheck` → Expected: no errors.
Run: `npm test` → Expected: **all** suites PASS (Part 1 domain + auth + all MCP).

- [ ] **Step 8: Commit**

```bash
git add src/mcp/registry.ts src/mcp/server.ts src/mcp/index.ts package.json tests/mcp.registry.test.ts
git commit -m "feat: assemble KithLedger MCP server (13 kith.* tools) with stdio entrypoint"
```

---

# PART 3 — Docs & Site

## Task 14: Update README and CLAUDE.md (document MCP; confirm no gRPC)

Document the MCP connection (a `kl_` key, the tool list, how to run) and refresh the module map now that primitives moved to core. There are **no gRPC references in this repo** (verified: the only `proto` matches are the word "protocol" in avatar-URL validation) — the gRPC site-copy correction is tracked in the program plan's "Website reconciliation" section and is out of scope here.

**Files:**
- Modify: `README.md`, `CLAUDE.md`
- Test: none (docs) — verified by grep + review

**Interfaces:**
- No code interfaces.

- [ ] **Step 1: Add an MCP section to `README.md`**

Insert this section after the "Authentication" section (before "Endpoint Reference"):

````markdown
## MCP Server

KithLedger exposes its domain to AI agents over the Model Context Protocol, in
addition to REST. The MCP server calls the same service layer as REST, so
business rules (recurrence, mutual relationships, conflict handling) and the
audit trail are identical.

### Run it

```bash
npm run mcp   # migrations + admin seed run automatically, then stdio transport
```

### Authenticate

Create a `kl_` API key over REST (`POST /api/v1/auth/keys`) and provide it as the
MCP credential. A valid key resolves to the single admin user; invalid or
non-`kl_` credentials are rejected.

### Tools (namespaced `kith.*`)

| Tool | Behavior |
|---|---|
| `kith.list_people` | List people (`q`, `tags`, `birthday_month`) |
| `kith.get_person` | Get one person |
| `kith.create_person` | Create a person |
| `kith.update_person` | Update a person |
| `kith.get_person_graph` | Ego network (`depth` 1-3) |
| `kith.list_interactions` | List interactions (`person_id`, `type`, `from`, `to`) |
| `kith.log_interaction` | Log an interaction |
| `kith.list_reminders` | List reminders (`status`, `overdue`) |
| `kith.create_reminder` | Create a reminder |
| `kith.complete_reminder` | Complete (creates next if recurring) |
| `kith.snooze_reminder` | Snooze a reminder |
| `kith.list_relationships` | List relationships |
| `kith.create_relationship` | Create a relationship |
````

- [ ] **Step 2: Update the `README.md` intro line to mention both surfaces**

Change the intro sentence that reads "KithLedger provides structured endpoints for both web interfaces and AI agents" to explicitly name the surfaces:

```markdown
KithLedger provides structured **REST and MCP** endpoints for both web interfaces and AI agents, keeping your entire social graph programmatically accessible. A ledger for the people who matter.
```

- [ ] **Step 3: Update `CLAUDE.md` — module structure + shared foundation note**

Replace the `## Module Structure` code block's `middleware/` and `lib/` subtrees (the primitives now live in `@wyrhta/core`) so it reads:

```
src/
├── index.ts           # Entrypoint: migrations, seed admin, start server
├── app.ts             # Hono app factory + middleware wiring (core middleware)
├── identity.ts        # @wyrhta/core identity service + auth guards, wired to db/config; seedAdmin/getAdminUser
├── config/env.ts      # Zod-validated env vars (single source of truth)
├── db/
│   ├── index.ts       # Drizzle client singleton
│   ├── schema/        # domain tables + re-export of core users/api_keys
│   └── migrations/    # Generated SQL migration files
├── routes/            # HTTP method + path only — no business logic
├── services/          # All business logic + Drizzle queries
├── validators/        # Zod input schemas (also reused as MCP tool inputSchemas)
└── mcp/               # MCP server: auth adapter, kith.* tools, registry, entrypoint
```

Then add a bullet under `## Architecture Notes`:

```markdown
- **Shared foundation:** the response envelope, pagination, request-id / security-headers / rate-limit / error-handler middleware, structured logger, crypto/api-key, and identity (users + api_keys, JWT, guards) come from `@wyrhta/core` (git-tag dependency). KithLedger is a single-user deployment: one `admin` user is seeded from `ADMIN_PASSWORD` at first boot; `POST /auth/token` authenticates that user and returns a core-issued JWT.
- **MCP surface:** `src/mcp/` assembles the `kith.*` tool registry via core's `createMcpServer`; tools call the service layer directly and share REST's auth (a `kl_` key → admin) and audit trail. Run with `npm run mcp`.
```

- [ ] **Step 4: Verify no stale gRPC copy and that docs build**

Run: `grep -rni "grpc" README.md CLAUDE.md` → Expected: no matches.
Run: `npm run typecheck` → Expected: no errors (sanity; docs-only change).

- [ ] **Step 5: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: document MCP surface and @wyrhta/core foundation"
```

---

## Final verification (run after all tasks)

- [ ] Run the full suite: `npm test` → **all** suites green (4 original domain suites unchanged + `identity.wiring`, `crypto`, `seed-admin`, `auth`, `mcp.auth`, `mcp.people`, `mcp.interactions`, `mcp.reminders`, `mcp.relationships`, `mcp.registry`).
- [ ] `npm run typecheck` → no errors.
- [ ] `npm run build` → compiles `dist/` without error.
- [ ] Confirm no dangling imports of deleted files: `grep -rn "middleware/auth\|middleware/api-key\|middleware/jwt\|middleware/request-id\|middleware/security-headers\|middleware/rate-limit\|middleware/error-handler\|lib/response\|lib/pagination\|lib/logger\|lib/crypto\|db/schema/api-keys" src tests` → no matches.

---

## Self-Review (completed by plan author)

**1. Spec coverage** — every requirement maps to a task:

- Add `@wyrhta/core` git-tag dependency → Task 1.
- Replace envelope/pagination → Task 2; middleware → Task 3; logger/crypto → Task 4. (Every "in-repo file → core import" swap has an explicit delete + import-swap step.)
- Auth migration: seed one admin from `ADMIN_PASSWORD` → Task 6; `POST /auth/token` → core JWT → Task 7; api_keys → core table, `kl_` prefix kept → Tasks 4/5/7.
- Household module not used → honored throughout (never imported).
- Domain schema/services behavior identical, only primitive imports change → Tasks 2-4 change imports only; Part-1 acceptance re-run in Tasks 2,3,4,5,7.
- Acceptance: existing integration tests pass unchanged → asserted in Tasks 2,3,4,5,7 + Final verification.
- MCP `src/mcp/` via core `createMcpServer`, tools `kith.*`, call existing services directly, shared auth + audit → Tasks 8-13.
- Exact tool set (13 tools) from the spec table → Tasks 9-12 cover all 13; Task 13 asserts the exact set of 13.
- MCP tests via same `tests/setup.ts` harness, parity with REST + auth enforcement → Tasks 9-13 (parity assertions + Task 8/13 auth enforcement).
- README/docs: remove gRPC, document MCP → Task 14 (verified repo has no gRPC; MCP documented).

**2. Placeholder scan** — no TBD/TODO/"add error handling"/"write tests for the above"/"similar to Task N". Every code step contains complete code; every command step states the exact command and expected result. The one genuinely unknowable artifact — the drizzle-generated migration SQL — is handled by an explicit `db:generate` → review → `db:migrate` flow with the expected schema delta spelled out, plus a concrete backfill SQL snippet for populated DBs.

**3. Type consistency** — names are consistent across tasks: `identity`, `requireAuth`, `requireJwt`, `getAdminUser`, `seedAdmin`, `ADMIN_EMAIL`, `ADMIN_HANDLE`, `API_KEY_PREFIX` (defined Task 1, used 6/7/8/13); tool arrays `peopleTools`/`interactionTools`/`reminderTools`/`relationshipTools` (defined 9-12, combined into `kithTools` in 13); result conventions (`{ items, total, limit, offset }` for lists; row object for single; `{ nodes, edges }`; `{ updated, next }`) are declared once in Task 9's Interfaces and applied identically in 10-13; error strings `NOT_FOUND`/`CONFLICT` map consistently from service errors (`PERSON_NOT_FOUND`, `RELATIONSHIP_EXISTS`, etc.).

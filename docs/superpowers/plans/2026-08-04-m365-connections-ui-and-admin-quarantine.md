# M365 Connections UI and Admin Quarantine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give members a UI to connect their Microsoft 365 account, and remove the seeded maintenance admin from every household-facing surface — enforced server-side, not just hidden in the UI.

**Architecture:** The maintenance admin is anchored on its unique, env-independent `handle` (`'admin'`). A single `assertNotMaintenanceAdmin(memberId)` guard lives in the service layer so REST, MCP, and API-key callers are all covered by one implementation; a Heorth-level `onError` wrapper turns the resulting error into a `403`. On the web side, a new `/profile` page renders connections through a frontend provider registry so a second provider (Google, CalDAV) slots in without touching the rendering component.

**Tech Stack:** Node.js 22, TypeScript (strict), Hono, Drizzle ORM, PostgreSQL 18, Zod, Vitest. Web: React, TanStack Router + Query, react-i18next, Tailwind, Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-04-m365-connections-ui-and-admin-quarantine-design.md`

## Global Constraints

- **Tests need a `_test` database.** `tests/setup.ts` TRUNCATEs every table and enforces an allowlist: `DATABASE_URL` must name a database ending in `_test`. Export it before `npm test`; the fallback is `localhost:55432/heorth_test`.
- **Never call Microsoft Graph in tests.** The suite forces the M365 integration disabled. Enabled-path tests install a fake via `setM365Runtime(runtimeForFakeGraph(createFakeGraph()))` and reset with `afterEach(() => setM365Runtime(null))`.
- **Never log or return token material.** Refresh tokens are encrypted at rest; error text from a token exchange may reference them and must not be surfaced.
- **`@wyrhta/core` is a pinned GitHub-tag dependency, not a workspace link.** Its `users` table and its `errorHandler` cannot be modified. Work around them in Heorth.
- **DB schema changes** register in BOTH `src/db/schema/drizzle-schema.ts` (no `.js`) and `src/db/schema/index.js` (with `.js`); migrations via `npm run db:generate -- --name <name>`, never hand-edited. *(This plan adds no schema changes — noted so no task invents one.)*
- **Responses use `ok`/`err` from `@wyrhta/core/http`.** Auth via `requireAuth` / `requireRole` from `src/wiring.ts`.
- **Language:** all code comments, commit messages and docs in English.
- **Commits:** no AI co-author trailers. Git operations against GitHub go through `gh`.
- **Verify before claiming done:** `npm run typecheck && npm run build`, `npm test`, and `cd web && npm test`.

---

## File Structure

**New backend files**

| File | Responsibility |
|---|---|
| `src/household/maintenance-admin.ts` | The single source of truth for "who is the maintenance admin": the handle constant, `isMaintenanceAdmin`, `assertNotMaintenanceAdmin`, `MaintenanceAdminError`, and `repairMaintenanceAdmin`. |

**Modified backend files**

| File | Change |
|---|---|
| `src/app.ts` | Wrap `onError` to map `MaintenanceAdminError` → 403. |
| `src/index.ts` | `seedAdmin()` anchors on handle, re-syncs credentials, calls `repairMaintenanceAdmin`. |
| `src/household/validators.ts` | Reject `handle: 'admin'` on member create. |
| `src/household/routes.ts` | Protect the admin from delete / role change / email change. |
| `src/modules/calendar/service.ts` | Quarantine `attendeeIds` + `created_by`. |
| `src/modules/meals/service.ts` | Quarantine recipe `created_by`, plan `cook`, plan `helper`. |
| `src/modules/tasks/service.ts` | Quarantine allowlist + outward-create paths. |
| `src/modules/library/service.ts` | Quarantine connection creation (service layer, not routes). |
| `src/satellites/feoh/proxy.ts` | Reject admin writes and admin split participants. |
| `src/satellites/feoh/roster.ts` | Exclude the admin from roster sync. |
| `src/m365/routes.ts` | Add `GET /connect-url`; redirect `/callback` to `/profile`. |

**New web files**

| File | Responsibility |
|---|---|
| `web/src/lib/providers.ts` | The provider registry + `ConnectionProvider` / `ProviderApi` types. |
| `web/src/components/profile/provider-card.tsx` | Renders one provider entry; owns the four connection states. |
| `web/src/pages/profile.tsx` | The `/profile` page: search-param toasts + the provider list. |
| `web/src/components/household/connections-panel.tsx` | Admin household-wide overview. |

**Modified web files:** `web/src/api/m365.ts`, `web/src/hooks/use-household.ts`, `web/src/app.tsx`, `web/src/components/layout/top-bar.tsx`, `web/src/components/layout/app-shell.tsx`, `web/src/pages/household.tsx`, `web/src/components/calendar/event-form.tsx`, `web/src/components/dashboard/members-row.tsx`, `web/src/pages/hearth.tsx`, `web/src/i18n/locales/{en,de}.json`.

---

### Task 1: The maintenance-admin anchor

Pure helpers plus the error type. Everything downstream imports from here.

**Files:**
- Create: `src/household/maintenance-admin.ts`
- Create: `tests/maintenance-admin.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `MAINTENANCE_ADMIN_HANDLE: 'admin'`
  - `class MaintenanceAdminError extends Error` with `code: 'ADMIN_NOT_A_MEMBER' | 'ADMIN_PROTECTED'`
  - `isMaintenanceAdmin(user: { handle: string } | null | undefined): boolean`
  - `isMaintenanceAdminId(memberId: string): Promise<boolean>`
  - `assertNotMaintenanceAdmin(memberId: string | null | undefined): Promise<void>` — throws `MaintenanceAdminError('ADMIN_NOT_A_MEMBER')`
  - `assertNoneAreMaintenanceAdmin(memberIds: readonly string[]): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `tests/maintenance-admin.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  MAINTENANCE_ADMIN_HANDLE, MaintenanceAdminError, isMaintenanceAdmin,
  isMaintenanceAdminId, assertNotMaintenanceAdmin, assertNoneAreMaintenanceAdmin,
} from '../src/household/maintenance-admin.js';
import { seedTestHousehold } from './helpers.js';

describe('maintenance-admin anchor', () => {
  it('anchors on the handle, not the email or the role', () => {
    expect(MAINTENANCE_ADMIN_HANDLE).toBe('admin');
    expect(isMaintenanceAdmin({ handle: 'admin' })).toBe(true);
    expect(isMaintenanceAdmin({ handle: 'adult' })).toBe(false);
    expect(isMaintenanceAdmin(null)).toBe(false);
  });

  it('resolves a member id against the anchor', async () => {
    const { admin, adult } = await seedTestHousehold();
    expect(await isMaintenanceAdminId(admin.user.id)).toBe(true);
    expect(await isMaintenanceAdminId(adult.user.id)).toBe(false);
    expect(await isMaintenanceAdminId('00000000-0000-0000-0000-000000000000')).toBe(false);
  });

  it('assertNotMaintenanceAdmin throws ADMIN_NOT_A_MEMBER for the admin only', async () => {
    const { admin, adult } = await seedTestHousehold();
    await expect(assertNotMaintenanceAdmin(admin.user.id)).rejects.toThrow(MaintenanceAdminError);
    await expect(assertNotMaintenanceAdmin(adult.user.id)).resolves.toBeUndefined();
    // null/undefined mean "no member assigned" — not a violation.
    await expect(assertNotMaintenanceAdmin(null)).resolves.toBeUndefined();
  });

  it('carries the ADMIN_NOT_A_MEMBER code', async () => {
    const { admin } = await seedTestHousehold();
    await expect(assertNotMaintenanceAdmin(admin.user.id)).rejects.toMatchObject({
      code: 'ADMIN_NOT_A_MEMBER',
    });
  });

  it('assertNoneAreMaintenanceAdmin rejects a list containing the admin', async () => {
    const { admin, adult, child } = await seedTestHousehold();
    await expect(assertNoneAreMaintenanceAdmin([adult.user.id, child.user.id])).resolves.toBeUndefined();
    await expect(assertNoneAreMaintenanceAdmin([adult.user.id, admin.user.id])).rejects.toThrow(MaintenanceAdminError);
    await expect(assertNoneAreMaintenanceAdmin([])).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/maintenance-admin.test.ts`
Expected: FAIL — cannot resolve `../src/household/maintenance-admin.js`.

- [ ] **Step 3: Write the implementation**

Create `src/household/maintenance-admin.ts`:

```ts
import { eq, inArray } from 'drizzle-orm';
import { users } from '@wyrhta/core/identity';
import { db } from '../db/index.js';

/**
 * The maintenance admin is anchored on its HANDLE, not its email.
 *
 * `users.handle` is UNIQUE (migration 0000) and `seedAdmin()` hardcodes it, so the
 * anchor is stable and independent of env. Anchoring on `ADMIN_EMAIL` was rejected
 * in review: rotating the email would seed a SECOND admin and silently leave the
 * old one as an ordinary, deletable, un-quarantined account — the exact state this
 * design exists to prevent.
 */
export const MAINTENANCE_ADMIN_HANDLE = 'admin';

export type MaintenanceAdminCode = 'ADMIN_NOT_A_MEMBER' | 'ADMIN_PROTECTED';

/**
 * Thrown by the quarantine guards. Mapped to a 403 by Heorth's `onError` wrapper
 * in `src/app.ts` — core's `errorHandler` only knows about ZodError and would
 * otherwise turn this into a 500.
 */
export class MaintenanceAdminError extends Error {
  constructor(
    public readonly code: MaintenanceAdminCode,
    message = 'The maintenance account cannot own household items',
  ) {
    super(message);
    this.name = 'MaintenanceAdminError';
  }
}

export function isMaintenanceAdmin(user: { handle: string } | null | undefined): boolean {
  return user?.handle === MAINTENANCE_ADMIN_HANDLE;
}

export async function isMaintenanceAdminId(memberId: string): Promise<boolean> {
  const [row] = await db
    .select({ handle: users.handle })
    .from(users)
    .where(eq(users.id, memberId))
    .limit(1);
  return isMaintenanceAdmin(row);
}

/**
 * The quarantine guard. A null/undefined member id means "nobody assigned" and is
 * always allowed — callers use it for nullable columns like `meal_plan_entries.cook`.
 */
export async function assertNotMaintenanceAdmin(memberId: string | null | undefined): Promise<void> {
  if (!memberId) return;
  if (await isMaintenanceAdminId(memberId)) throw new MaintenanceAdminError('ADMIN_NOT_A_MEMBER');
}

/** Batch form — one query regardless of list length. */
export async function assertNoneAreMaintenanceAdmin(memberIds: readonly string[]): Promise<void> {
  if (memberIds.length === 0) return;
  const rows = await db
    .select({ handle: users.handle })
    .from(users)
    .where(inArray(users.id, [...memberIds]));
  if (rows.some(isMaintenanceAdmin)) throw new MaintenanceAdminError('ADMIN_NOT_A_MEMBER');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/maintenance-admin.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/household/maintenance-admin.ts tests/maintenance-admin.test.ts
git commit -m "feat(household): anchor the maintenance admin on its unique handle"
```

---

### Task 2: Map the quarantine error to a 403

Without this, every guard added in Tasks 4–8 returns a 500. Do it before any guard exists so the guards' tests can assert on status codes.

**Files:**
- Modify: `src/app.ts:54`
- Create: `tests/maintenance-admin-error.test.ts`

**Interfaces:**
- Consumes: `MaintenanceAdminError` (Task 1).
- Produces: any thrown `MaintenanceAdminError` becomes `403` with the error's own `code` and message, via the standard `{ error: { code, message } }` envelope.

- [ ] **Step 1: Write the failing test**

Create `tests/maintenance-admin-error.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { createApp } from '../src/app.js';
import { MaintenanceAdminError } from '../src/household/maintenance-admin.js';

describe('MaintenanceAdminError mapping', () => {
  it('maps a thrown MaintenanceAdminError to 403 with its code', async () => {
    const app = createApp([]);
    app.get('/boom', () => { throw new MaintenanceAdminError('ADMIN_NOT_A_MEMBER'); });

    const res = await app.request('/boom');
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('ADMIN_NOT_A_MEMBER');
    expect(body.error.message).toContain('maintenance account');
  });

  it('maps ADMIN_PROTECTED too', async () => {
    const app = createApp([]);
    app.get('/boom', () => { throw new MaintenanceAdminError('ADMIN_PROTECTED', 'Nope'); });

    const res = await app.request('/boom');
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('ADMIN_PROTECTED');
  });

  it('still delegates unknown errors to core (500, no detail leak)', async () => {
    const app = createApp([]);
    app.get('/boom', () => { throw new Error('secret internal detail'); });

    const res = await app.request('/boom');
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(body)).not.toContain('secret internal detail');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/maintenance-admin-error.test.ts`
Expected: FAIL — the first two cases get 500 instead of 403.

- [ ] **Step 3: Wrap the error handler**

In `src/app.ts`, add the import:

```ts
import { MaintenanceAdminError } from './household/maintenance-admin.js';
```

Replace `app.onError(errorHandler);` (line 54) with:

```ts
  // Core's errorHandler only classifies ZodError; anything else becomes a 500.
  // Core is a pinned dependency, so the quarantine's 403 is mapped here instead
  // of in every route — this also covers routes added later for free.
  app.onError((error, c) => {
    if (error instanceof MaintenanceAdminError) {
      return c.json({ error: { code: error.code, message: error.message } }, 403);
    }
    return errorHandler(error, c);
  });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/maintenance-admin-error.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Confirm nothing else regressed**

Run: `npm test -- tests/health.test.ts tests/module-convention.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app.ts tests/maintenance-admin-error.test.ts
git commit -m "feat(http): map MaintenanceAdminError to a 403 in Heorth's error handler"
```

---

### Task 3: Protect the admin account from removal and alteration

**Files:**
- Modify: `src/household/validators.ts:6-13` (create schema), `src/household/service.ts` (createMember), `src/household/routes.ts:65-99`
- Modify: `tests/household-routes.test.ts`

**Interfaces:**
- Consumes: `MAINTENANCE_ADMIN_HANDLE`, `MaintenanceAdminError`, `isMaintenanceAdminId` (Task 1); the 403 mapping (Task 2).
- Produces: `DELETE /members/:id`, `PATCH /members/:id/role`, and email changes via `PATCH /members/:id` all reject the admin with `403 ADMIN_PROTECTED`; `POST /members` with `handle: 'admin'` rejects the same way.

Note: `updateMemberSchema` has no `handle` field, so handle can only be claimed at creation — guard `createMember` only.

- [ ] **Step 1: Write the failing tests**

Append to `tests/household-routes.test.ts` (match the file's existing app/auth setup):

```ts
describe('maintenance admin protection', () => {
  it('refuses to delete the maintenance admin', async () => {
    const { admin } = await seedTestHousehold();
    const res = await app.request(`/api/v1/members/${admin.user.id}`, {
      method: 'DELETE', headers: authHeaders(admin.jwt),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('ADMIN_PROTECTED');
  });

  it('refuses to demote the maintenance admin', async () => {
    const { admin } = await seedTestHousehold();
    const res = await app.request(`/api/v1/members/${admin.user.id}/role`, {
      method: 'PATCH', headers: authHeaders(admin.jwt), body: JSON.stringify({ role: 'adult' }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('ADMIN_PROTECTED');
  });

  it('refuses to change the maintenance admin email', async () => {
    const { admin } = await seedTestHousehold();
    const res = await app.request(`/api/v1/members/${admin.user.id}`, {
      method: 'PATCH', headers: authHeaders(admin.jwt),
      body: JSON.stringify({ email: 'someone-else@test.local' }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('ADMIN_PROTECTED');
  });

  it('still allows editing the admin display name', async () => {
    const { admin } = await seedTestHousehold();
    const res = await app.request(`/api/v1/members/${admin.user.id}`, {
      method: 'PATCH', headers: authHeaders(admin.jwt),
      body: JSON.stringify({ displayName: 'Maintenance' }),
    });
    expect(res.status).toBe(200);
  });

  it('refuses to create a member claiming the admin handle', async () => {
    const { admin } = await seedTestHousehold();
    const res = await app.request('/api/v1/members', {
      method: 'POST', headers: authHeaders(admin.jwt),
      body: JSON.stringify({
        email: 'imposter@test.local', password: 'pw-imposter-1',
        displayName: 'Imposter', avatarColor: 'sage', handle: 'admin',
      }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('ADMIN_PROTECTED');
  });

  it('still deletes an ordinary member', async () => {
    const { admin, child } = await seedTestHousehold();
    const res = await app.request(`/api/v1/members/${child.user.id}`, {
      method: 'DELETE', headers: authHeaders(admin.jwt),
    });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/household-routes.test.ts`
Expected: FAIL on the five new protection cases (the delete/demote succeed today).

- [ ] **Step 3: Guard the handle at creation**

In `src/household/service.ts`, add to the imports:

```ts
import { MAINTENANCE_ADMIN_HANDLE, MaintenanceAdminError } from './maintenance-admin.js';
```

In `createMember`, before the `identity.createUser` call:

```ts
  // The UNIQUE constraint already makes the handle unclaimable once seeded; this
  // closes the pre-seed window and returns a clear 403 instead of a conflict.
  if (input.handle === MAINTENANCE_ADMIN_HANDLE) {
    throw new MaintenanceAdminError('ADMIN_PROTECTED', 'That handle is reserved');
  }
```

- [ ] **Step 4: Guard the mutation routes**

In `src/household/routes.ts`, add the import:

```ts
import { isMaintenanceAdminId } from './maintenance-admin.js';
```

In the `PATCH /:id` handler, after the body parses successfully and before `service.updateMember`:

```ts
  if (body.data.email !== undefined && (await isMaintenanceAdminId(id))) {
    return err(c, 'ADMIN_PROTECTED', 'The maintenance account email is managed by env', 403);
  }
```

At the top of the `PATCH /:id/role` handler, before the body parse:

```ts
  if (await isMaintenanceAdminId(c.req.param('id'))) {
    return err(c, 'ADMIN_PROTECTED', 'The maintenance account cannot be demoted', 403);
  }
```

At the top of the `DELETE /:id` handler, inside the `try`, before `service.deleteMember`:

```ts
    if (await isMaintenanceAdminId(c.req.param('id'))) {
      return err(c, 'ADMIN_PROTECTED', 'The maintenance account cannot be removed', 403);
    }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- tests/household-routes.test.ts tests/household-service.test.ts tests/household-mcp.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/household/ tests/household-routes.test.ts
git commit -m "feat(household): protect the maintenance admin from deletion, demotion and email change"
```

---

### Task 4: Boot-time seed, credential re-sync and repair

**Files:**
- Modify: `src/household/maintenance-admin.ts` (add `repairMaintenanceAdmin`)
- Modify: `src/index.ts:20-31` (`seedAdmin`)
- Create: `tests/maintenance-admin-repair.test.ts`

**Interfaces:**
- Consumes: `MAINTENANCE_ADMIN_HANDLE` (Task 1).
- Produces:
  ```ts
  export interface RepairInput { adminEmail: string; adminPassword: string }
  export async function repairMaintenanceAdmin(input: RepairInput): Promise<{ adminId: string }>
  ```
  Taking credentials as parameters is deliberate: `config` is parsed at module load (`src/config/env.ts:87`), so a test cannot re-run this under a changed `ADMIN_PASSWORD` otherwise.

- [ ] **Step 1: Write the failing test**

Create `tests/maintenance-admin-repair.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { users } from '@wyrhta/core/identity';
import { db } from '../src/db/index.js';
import { repairMaintenanceAdmin } from '../src/household/maintenance-admin.js';
import { events, eventAttendees } from '../src/modules/calendar/schema.js';
import { recipes, mealPlanEntries } from '../src/modules/meals/schema.js';
import { identity, householdCore } from '../src/wiring.js';
import { seedTestHousehold } from './helpers.js';

const CREDS = { adminEmail: 'admin@test.local', adminPassword: 'test-admin-password' };

describe('repairMaintenanceAdmin', () => {
  it('seeds the admin when absent', async () => {
    await householdCore.seedHousehold({ name: 'Test Household' });
    const { adminId } = await repairMaintenanceAdmin(CREDS);

    const [row] = await db.select().from(users).where(eq(users.id, adminId));
    expect(row!.handle).toBe('admin');
    expect(row!.role).toBe('admin');
    expect(row!.email).toBe('admin@test.local');
  });

  it('rotates ADMIN_EMAIL in place without creating a second admin', async () => {
    await seedTestHousehold();
    await repairMaintenanceAdmin({ ...CREDS, adminEmail: 'newadmin@test.local' });

    const admins = await db.select().from(users).where(eq(users.handle, 'admin'));
    expect(admins).toHaveLength(1);
    expect(admins[0]!.email).toBe('newadmin@test.local');
  });

  it('re-syncs a changed password so env stays the source of truth', async () => {
    await seedTestHousehold();
    const [before] = await db.select().from(users).where(eq(users.handle, 'admin'));

    await repairMaintenanceAdmin({ ...CREDS, adminPassword: 'a-brand-new-password' });

    const [after] = await db.select().from(users).where(eq(users.handle, 'admin'));
    expect(after!.passwordHash).not.toBe(before!.passwordHash);
  });

  it('restores the admin role if it drifted', async () => {
    const { admin } = await seedTestHousehold();
    await db.update(users).set({ role: 'child' }).where(eq(users.id, admin.user.id));

    await repairMaintenanceAdmin(CREDS);

    const [row] = await db.select().from(users).where(eq(users.id, admin.user.id));
    expect(row!.role).toBe('admin');
  });

  it('fails loudly when ADMIN_EMAIL is held by a different member', async () => {
    await seedTestHousehold();
    await identity.createUser({
      email: 'squatter@test.local', handle: 'squatter', password: 'pw-squatter-1',
      role: 'adult', displayName: 'Squatter', avatarColor: 'sky',
    });

    await expect(
      repairMaintenanceAdmin({ ...CREDS, adminEmail: 'squatter@test.local' }),
    ).rejects.toThrow(/already held/i);
  });

  it('strips admin-owned household data and repoints creators', async () => {
    const { admin, adult } = await seedTestHousehold();
    const [event] = await db.insert(events).values({
      title: 'Admin event', startAt: new Date(), endAt: new Date(), createdBy: admin.user.id,
    }).returning();
    await db.insert(eventAttendees).values({ eventId: event!.id, memberId: admin.user.id });
    await db.insert(recipes).values({ title: 'Admin recipe', createdBy: admin.user.id });
    await db.insert(mealPlanEntries).values({
      date: '2026-08-04', slot: 'supper', cook: admin.user.id, helper: admin.user.id,
    });

    await repairMaintenanceAdmin(CREDS);

    expect(await db.select().from(eventAttendees)).toHaveLength(0);
    const [ev] = await db.select().from(events);
    expect(ev!.createdBy).toBe(adult.user.id);
    const [rec] = await db.select().from(recipes);
    expect(rec!.createdBy).toBe(adult.user.id);
    const [entry] = await db.select().from(mealPlanEntries);
    expect(entry!.cook).toBeNull();
    expect(entry!.helper).toBeNull();
  });

  it('is idempotent', async () => {
    const { admin } = await seedTestHousehold();
    await db.insert(recipes).values({ title: 'Admin recipe', createdBy: admin.user.id });

    await repairMaintenanceAdmin(CREDS);
    await expect(repairMaintenanceAdmin(CREDS)).resolves.toBeDefined();

    const admins = await db.select().from(users).where(eq(users.handle, 'admin'));
    expect(admins).toHaveLength(1);
  });

  it('skips creator repointing when no non-admin member exists', async () => {
    await householdCore.seedHousehold({ name: 'Test Household' });
    const { adminId } = await repairMaintenanceAdmin(CREDS);
    await db.insert(recipes).values({ title: 'Lonely recipe', createdBy: adminId });

    await expect(repairMaintenanceAdmin(CREDS)).resolves.toBeDefined();

    const [rec] = await db.select().from(recipes);
    expect(rec!.createdBy).toBe(adminId); // left alone; repaired on a later boot
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/maintenance-admin-repair.test.ts`
Expected: FAIL — `repairMaintenanceAdmin` is not exported.

- [ ] **Step 3: Implement `repairMaintenanceAdmin`**

Append to `src/household/maintenance-admin.ts`:

```ts
import { and, asc, isNull, ne, sql } from 'drizzle-orm';
import { createUser, hashPassword, verifyPassword } from '@wyrhta/core/identity';
import { events, eventAttendees } from '../modules/calendar/schema.js';
import { recipes, mealPlanEntries } from '../modules/meals/schema.js';
import { libraryConnections } from '../modules/library/schema.js';
import { m365Connections } from '../m365/schema.js';
import { taskMirror, todoListAllowlist } from '../modules/tasks/schema.js';
import { calendarMirrorEvents } from '../modules/calendar/mirror-schema.js';

export interface RepairInput {
  adminEmail: string;
  adminPassword: string;
}

/**
 * Seed / re-sync / repair the maintenance admin. Idempotent; runs on every boot.
 *
 * Credentials are parameters rather than reads of `config` so this is testable:
 * `src/config/env.ts` parses env at module load, and a test cannot change
 * ADMIN_PASSWORD after that without module-state surgery.
 */
export async function repairMaintenanceAdmin(input: RepairInput): Promise<{ adminId: string }> {
  const [anchored] = await db.select().from(users)
    .where(eq(users.handle, MAINTENANCE_ADMIN_HANDLE)).limit(1);

  let adminId: string;
  if (!anchored) {
    // No anchored admin. Refuse to seed if the configured email already belongs
    // to somebody else — that is an operator error, not something to paper over.
    const [emailOwner] = await db.select().from(users)
      .where(eq(users.email, input.adminEmail)).limit(1);
    if (emailOwner) {
      throw new Error(
        `ADMIN_EMAIL is already held by member ${emailOwner.id} (handle '${emailOwner.handle}'). ` +
          'Change ADMIN_EMAIL or rename that member before starting.',
      );
    }
    const created = await createUser(db, {
      email: input.adminEmail, handle: MAINTENANCE_ADMIN_HANDLE,
      password: input.adminPassword, role: 'admin', displayName: 'Admin',
    });
    adminId = created.id;
  } else {
    adminId = anchored.id;
    // Re-sync env onto the anchored row: env is the source of truth, so an
    // ADMIN_EMAIL rotation is an in-place update, never a second account.
    const patch: Record<string, unknown> = {};
    if (anchored.email !== input.adminEmail) {
      const [emailOwner] = await db.select().from(users)
        .where(and(eq(users.email, input.adminEmail), ne(users.id, adminId))).limit(1);
      if (emailOwner) {
        throw new Error(
          `ADMIN_EMAIL is already held by member ${emailOwner.id} (handle '${emailOwner.handle}').`,
        );
      }
      patch['email'] = input.adminEmail;
    }
    if (anchored.role !== 'admin') patch['role'] = 'admin';
    if (!(await verifyPassword(input.adminPassword, anchored.passwordHash))) {
      patch['passwordHash'] = await hashPassword(input.adminPassword);
    }
    if (Object.keys(patch).length > 0) {
      patch['updatedAt'] = new Date();
      await db.update(users).set(patch).where(eq(users.id, adminId));
    }
  }

  await stripAdminOwnedData(adminId);
  return { adminId };
}

/**
 * Remove every trace of the admin from household content. Mirror rows are derived
 * data — a re-sync rebuilds them — so they are deleted rather than repointed.
 */
async function stripAdminOwnedData(adminId: string): Promise<void> {
  await db.delete(eventAttendees).where(eq(eventAttendees.memberId, adminId));
  await db.delete(m365Connections).where(eq(m365Connections.memberId, adminId));
  await db.delete(libraryConnections).where(eq(libraryConnections.memberId, adminId));
  await db.delete(todoListAllowlist).where(eq(todoListAllowlist.memberId, adminId));
  await db.delete(taskMirror).where(eq(taskMirror.memberId, adminId));
  await db.delete(calendarMirrorEvents).where(eq(calendarMirrorEvents.memberId, adminId));

  // `cook`/`helper` are nullable with ON DELETE set null — clearing is the
  // schema's own notion of "unassigned", so no repointing is needed.
  await db.update(mealPlanEntries).set({ cook: null }).where(eq(mealPlanEntries.cook, adminId));
  await db.update(mealPlanEntries).set({ helper: null }).where(eq(mealPlanEntries.helper, adminId));

  // `created_by` is NOT NULL, so it must be repointed. With no non-admin member
  // there is nothing to point at; leave it and repair on a later boot.
  const [heir] = await db.select({ id: users.id }).from(users)
    .where(ne(users.handle, MAINTENANCE_ADMIN_HANDLE))
    .orderBy(asc(users.createdAt)).limit(1);
  if (!heir) return;

  await db.update(events).set({ createdBy: heir.id }).where(eq(events.createdBy, adminId));
  await db.update(recipes).set({ createdBy: heir.id }).where(eq(recipes.createdBy, adminId));
}
```

If `hashPassword` / `verifyPassword` are not exported from `@wyrhta/core/identity` under those names, check `node_modules/@wyrhta/core/dist/identity/password.d.ts` and use the actual exports; do not reimplement hashing.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/maintenance-admin-repair.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Call it from bootstrap**

In `src/index.ts`, delete the `seedAdmin` function (lines 16-31) and its now-unused `createUser` / `users` / `eq` imports if nothing else uses them. Add:

```ts
import { repairMaintenanceAdmin } from './household/maintenance-admin.js';
```

In `bootstrap()`, replace `await seedAdmin();` with:

```ts
  // Seeds the maintenance admin, re-syncs its env credentials, and strips any
  // household data it accumulated. Idempotent — safe on every boot.
  await repairMaintenanceAdmin({
    adminEmail: config.adminEmail,
    adminPassword: config.adminPassword,
  });
```

Update the `console.log` in `main()` to say `migrations, household + admin seed/repair, module registration...`.

- [ ] **Step 6: Verify bootstrap still works**

Run: `npm test -- tests/bootstrap.test.ts tests/integration-smoke.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/household/maintenance-admin.ts src/index.ts tests/maintenance-admin-repair.test.ts
git commit -m "feat(bootstrap): seed, re-sync and repair the maintenance admin on every boot"
```

---

### Task 5: Quarantine the calendar

**Files:**
- Modify: `src/modules/calendar/service.ts` (`createEvent`, `updateEvent`)
- Modify: `tests/calendar-routes.test.ts`, `tests/calendar-service.test.ts`, `tests/calendar-mcp.test.ts`, `tests/m365-calendar-sync.test.ts`

**Interfaces:**
- Consumes: `assertNotMaintenanceAdmin`, `assertNoneAreMaintenanceAdmin` (Task 1); the 403 mapping (Task 2).
- Produces: `createEvent` / `updateEvent` throw `MaintenanceAdminError` when the admin is the creator or an attendee.

**Blast radius:** `seedTestHousehold()` creates its admin with `handle: 'admin'`, so existing tests that create events as `admin.jwt` will now 403. Those calls must move to `adult.jwt`. This is expected and is part of the task.

- [ ] **Step 1: Write the failing test**

Append to `tests/calendar-routes.test.ts`:

```ts
describe('maintenance admin quarantine', () => {
  it('refuses to create an event with the admin as creator', async () => {
    const { admin } = await seedTestHousehold();
    const res = await app.request('/api/v1/events', {
      method: 'POST', headers: authHeaders(admin.jwt),
      body: JSON.stringify({
        title: 'Admin event',
        startAt: '2026-08-04T10:00:00Z', endAt: '2026-08-04T11:00:00Z',
      }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('ADMIN_NOT_A_MEMBER');
  });

  it('refuses to add the admin as an attendee', async () => {
    const { admin, adult } = await seedTestHousehold();
    const res = await app.request('/api/v1/events', {
      method: 'POST', headers: authHeaders(adult.jwt),
      body: JSON.stringify({
        title: 'Family dinner',
        startAt: '2026-08-04T10:00:00Z', endAt: '2026-08-04T11:00:00Z',
        attendeeIds: [adult.user.id, admin.user.id],
      }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('ADMIN_NOT_A_MEMBER');
  });

  it('refuses to patch the admin onto an existing event', async () => {
    const { admin, adult } = await seedTestHousehold();
    const created = await app.request('/api/v1/events', {
      method: 'POST', headers: authHeaders(adult.jwt),
      body: JSON.stringify({
        title: 'Family dinner',
        startAt: '2026-08-04T10:00:00Z', endAt: '2026-08-04T11:00:00Z',
        attendeeIds: [adult.user.id],
      }),
    });
    const { data } = await created.json();

    const res = await app.request(`/api/v1/events/${data.id}`, {
      method: 'PATCH', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ attendeeIds: [admin.user.id] }),
    });
    expect(res.status).toBe(403);
  });

  it('still lets an ordinary member create an event', async () => {
    const { adult } = await seedTestHousehold();
    const res = await app.request('/api/v1/events', {
      method: 'POST', headers: authHeaders(adult.jwt),
      body: JSON.stringify({
        title: 'Adult event',
        startAt: '2026-08-04T10:00:00Z', endAt: '2026-08-04T11:00:00Z',
        attendeeIds: [adult.user.id],
      }),
    });
    expect(res.status).toBe(201);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/calendar-routes.test.ts`
Expected: FAIL on the three quarantine cases (they currently succeed).

- [ ] **Step 3: Add the guards**

In `src/modules/calendar/service.ts`, add the import:

```ts
import { assertNotMaintenanceAdmin, assertNoneAreMaintenanceAdmin } from '../../household/maintenance-admin.js';
```

At the top of `createEvent(input, createdBy)`:

```ts
  // The maintenance admin is not a household person: it may neither own nor
  // attend anything. Guarded here (service layer) so REST, MCP and API-key
  // callers are all covered by one implementation.
  await assertNotMaintenanceAdmin(createdBy);
  await assertNoneAreMaintenanceAdmin(input.attendeeIds ?? []);
```

At the top of `updateEvent(id, input)`, after the existing `isMirrorEvent` check:

```ts
  if (input.attendeeIds) await assertNoneAreMaintenanceAdmin(input.attendeeIds);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/calendar-routes.test.ts`
Expected: PASS for the new cases. Other tests in the file may now fail — that is Step 5.

- [ ] **Step 5: Migrate existing tests off the admin**

Run the full calendar + sync suite:

```bash
npm test -- tests/calendar-routes.test.ts tests/calendar-service.test.ts tests/calendar-mcp.test.ts tests/calendar-recurrence.test.ts tests/m365-calendar-sync.test.ts
```

For each failure where a test creates or attends an event as the admin, switch that call to `adult` (`adult.jwt`, `adult.user.id`) — the admin was incidental scaffolding, not the thing under test. Do **not** weaken the guard to make a test pass. Leave genuinely admin-scoped assertions (role checks, admin-only routes) alone.

- [ ] **Step 6: Run the full backend suite**

Run: `npm test`
Expected: PASS. Failures outside calendar belong to Tasks 6–8; if any appear, note them and leave them.

- [ ] **Step 7: Commit**

```bash
git add src/modules/calendar/service.ts tests/
git commit -m "feat(calendar): quarantine the maintenance admin from events and attendees"
```

---

### Task 6: Quarantine meals

**Files:**
- Modify: `src/modules/meals/service.ts` (`createRecipe`, `upsertPlanEntry`)
- Modify: `tests/meals-routes.test.ts`, `tests/meals-mcp.test.ts`, `tests/meals-shopping.test.ts`, `tests/meals-schema.test.ts`

**Interfaces:**
- Consumes: `assertNotMaintenanceAdmin` (Task 1); the 403 mapping (Task 2).
- Produces: recipe `created_by` and plan-entry `cook` / `helper` all reject the admin.

`meal_plan_entries.cook` and `.helper` are real member FKs (`src/modules/meals/schema.ts:33-34`) accepted by REST (`validators.ts:25-26`) and MCP (`mcp.ts:47`). The web UI exposes no cook/helper picker today, so this is a server-side-only gap.

- [ ] **Step 1: Write the failing test**

Append to `tests/meals-routes.test.ts`:

```ts
describe('maintenance admin quarantine', () => {
  it('refuses a recipe created by the admin', async () => {
    const { admin } = await seedTestHousehold();
    const res = await app.request('/api/v1/recipes', {
      method: 'POST', headers: authHeaders(admin.jwt),
      body: JSON.stringify({ title: 'Admin stew' }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('ADMIN_NOT_A_MEMBER');
  });

  it('refuses the admin as cook', async () => {
    const { admin, adult } = await seedTestHousehold();
    const res = await app.request('/api/v1/meal-plan', {
      method: 'PUT', headers: authHeaders(adult.jwt),
      body: JSON.stringify({
        date: '2026-08-04', slot: 'supper', freeText: 'Pasta', cook: admin.user.id,
      }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('ADMIN_NOT_A_MEMBER');
  });

  it('refuses the admin as helper', async () => {
    const { admin, adult } = await seedTestHousehold();
    const res = await app.request('/api/v1/meal-plan', {
      method: 'PUT', headers: authHeaders(adult.jwt),
      body: JSON.stringify({
        date: '2026-08-04', slot: 'supper', freeText: 'Pasta',
        cook: adult.user.id, helper: admin.user.id,
      }),
    });
    expect(res.status).toBe(403);
  });

  it('still accepts an ordinary member as cook, and a null cook', async () => {
    const { adult } = await seedTestHousehold();
    const assigned = await app.request('/api/v1/meal-plan', {
      method: 'PUT', headers: authHeaders(adult.jwt),
      body: JSON.stringify({
        date: '2026-08-04', slot: 'supper', freeText: 'Pasta', cook: adult.user.id,
      }),
    });
    expect(assigned.status).toBe(200);

    const unassigned = await app.request('/api/v1/meal-plan', {
      method: 'PUT', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ date: '2026-08-05', slot: 'supper', freeText: 'Soup', cook: null }),
    });
    expect(unassigned.status).toBe(200);
  });
});
```

Confirm the meal-plan route path and verb against `src/modules/meals/routes.ts` before running; use whatever that file actually mounts.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/meals-routes.test.ts`
Expected: FAIL on the three quarantine cases.

- [ ] **Step 3: Add the guards**

In `src/modules/meals/service.ts`, add the import:

```ts
import { assertNotMaintenanceAdmin } from '../../household/maintenance-admin.js';
```

At the top of `createRecipe(input, createdBy)`:

```ts
  await assertNotMaintenanceAdmin(createdBy);
```

At the top of `upsertPlanEntry(input)`:

```ts
  // cook/helper are nullable — a null means "unassigned" and passes the guard.
  await assertNotMaintenanceAdmin(input.cook);
  await assertNotMaintenanceAdmin(input.helper);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/meals-routes.test.ts`
Expected: PASS for the new cases.

- [ ] **Step 5: Migrate existing meals tests off the admin**

Run: `npm test -- tests/meals-routes.test.ts tests/meals-mcp.test.ts tests/meals-shopping.test.ts tests/meals-schema.test.ts`

Switch recipe-creating calls from `admin` to `adult`, as in Task 5 Step 5. Do not weaken the guard.

- [ ] **Step 6: Commit**

```bash
git add src/modules/meals/service.ts tests/
git commit -m "feat(meals): quarantine the maintenance admin from recipes, cook and helper"
```

---

### Task 7: Quarantine tasks, library connections and Feoh

**Files:**
- Modify: `src/modules/tasks/service.ts` (`listAvailableLists`, `setAllowlist`, the outward-create path)
- Modify: `src/modules/library/service.ts` (`createLibraryThingConnection`, `pollTraktDevice`)
- Modify: `src/satellites/feoh/proxy.ts`, `src/satellites/feoh/roster.ts`
- Modify: `tests/library-connections.test.ts`, `tests/feoh-proxy.test.ts`, `tests/m365-tasks-sync.test.ts`

**Interfaces:**
- Consumes: `assertNotMaintenanceAdmin`, `isMaintenanceAdmin`, `isMaintenanceAdminId` (Task 1); the 403 mapping (Task 2).
- Produces: no path can create an admin-owned To Do allowlist entry, library connection, Feoh transaction, Feoh split, or Feoh party.

The library guards go in the **service**, not the routes: `createLibraryThingConnection` and `pollTraktDevice` insert whatever `memberId` they are handed (`src/modules/library/service.ts:35,58`), so a route-only guard leaves a direct-call path open.

- [ ] **Step 1: Write the failing tests**

Append to `tests/library-connections.test.ts`:

```ts
describe('maintenance admin quarantine', () => {
  it('refuses a LibraryThing connection for the admin, even called directly', async () => {
    const { admin } = await seedTestHousehold();
    await expect(
      libraryService.createLibraryThingConnection(admin.user.id, { externalRef: 'lt-user' }),
    ).rejects.toMatchObject({ code: 'ADMIN_NOT_A_MEMBER' });
  });
});
```

Match the real signature of `createLibraryThingConnection` in `src/modules/library/service.ts` and the file's existing import style.

Append to `tests/feoh-proxy.test.ts`:

```ts
describe('maintenance admin quarantine', () => {
  it('refuses a finance write by the admin', async () => {
    const { admin } = await seedTestHousehold();
    const res = await app.request('/api/v1/finance/transactions', {
      method: 'POST', headers: authHeaders(admin.jwt),
      body: JSON.stringify({ amount: '10.00', description: 'Admin spend' }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('ADMIN_NOT_A_MEMBER');
  });

  it('refuses the admin as a split participant', async () => {
    const { admin, adult } = await seedTestHousehold();
    const res = await app.request('/api/v1/finance/transactions', {
      method: 'POST', headers: authHeaders(adult.jwt),
      body: JSON.stringify({
        amount: '10.00', description: 'Shared',
        splits: [{ memberId: admin.user.id, share: 1 }],
      }),
    });
    expect(res.status).toBe(403);
  });

  it('still allows an adult to write', async () => {
    const { adult } = await seedTestHousehold();
    const res = await app.request('/api/v1/finance/transactions', {
      method: 'POST', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ amount: '10.00', description: 'Groceries' }),
    });
    expect(res.status).toBeLessThan(400);
  });
});
```

Match the transaction path and body shape to what `tests/feoh-proxy.test.ts` already uses against the fake Feoh.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/library-connections.test.ts tests/feoh-proxy.test.ts`
Expected: FAIL on the new quarantine cases.

- [ ] **Step 3: Guard tasks**

In `src/modules/tasks/service.ts`, add the import:

```ts
import { assertNotMaintenanceAdmin } from '../../household/maintenance-admin.js';
```

Add `await assertNotMaintenanceAdmin(memberId);` as the first line of `listAvailableLists` and `setAllowlist`. In the outward-create path, guard the acting member id before the provider call.

Tasks have no free assignee field — ownership is derived from the To Do feed owner — and the admin can never connect M365, so no admin feed can exist. These guards are defence in depth.

- [ ] **Step 4: Guard library connections**

In `src/modules/library/service.ts`, add the same import and put `await assertNotMaintenanceAdmin(memberId);` as the first line of `createLibraryThingConnection` and `pollTraktDevice`.

- [ ] **Step 5: Guard Feoh**

In `src/satellites/feoh/proxy.ts`, add the import and guard the acting principal on every write route (the ones behind `canWrite`):

```ts
  await assertNotMaintenanceAdmin(c.get('auth').userId);
```

In `transformRecordTransaction`, guard each split's member id before translating it to a party:

```ts
    await assertNoneAreMaintenanceAdmin(
      (body['splits'] as Array<{ memberId: string }>).map((s) => s.memberId),
    );
```

In `src/satellites/feoh/roster.ts`, skip the admin in both `upsertMember` and `runSync` so no Feoh party is ever created for it:

```ts
    // The maintenance admin is not a finance actor — never mirror it into Feoh.
    if (isMaintenanceAdmin(m)) continue;
```

`listMembers()` returns rows carrying `handle`; if it does not, select it, or fall back to `await isMaintenanceAdminId(m.id)`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -- tests/library-connections.test.ts tests/feoh-proxy.test.ts tests/m365-tasks-sync.test.ts tests/library-routes.test.ts tests/library-schema.test.ts`
Expected: PASS. Migrate any incidental admin usage to `adult` as in Task 5 Step 5.

- [ ] **Step 7: Run the full backend suite**

Run: `npm test`
Expected: PASS — this is the last backend quarantine task, so nothing should be left failing.

- [ ] **Step 8: Commit**

```bash
git add src/modules/tasks/service.ts src/modules/library/service.ts src/satellites/feoh/ tests/
git commit -m "feat: quarantine the maintenance admin from tasks, library connections and Feoh"
```

---

### Task 8: M365 backend deltas for the browser flow

**Files:**
- Modify: `src/m365/routes.ts:41-73`
- Modify: `tests/m365-routes.test.ts`

**Interfaces:**
- Consumes: `assertNotMaintenanceAdmin` (Task 1).
- Produces:
  - `GET /api/v1/m365/connect-url` (auth) → `200 { data: { url: string } }`
  - `GET /api/v1/m365/callback` → `302` to `/profile?connected=m365` or `/profile?connectError=<CODE>`

The web client sends `Authorization: Bearer` from `localStorage` (`web/src/api/client.ts:20-28`), which a top-level browser navigation cannot carry — hence a JSON route rather than linking to the existing `/connect` redirect. `/connect` stays unchanged.

- [ ] **Step 1: Write the failing test**

Append to `tests/m365-routes.test.ts`:

```ts
describe('GET /connect-url', () => {
  it('requires auth', async () => {
    setM365Runtime(runtimeForFakeGraph(createFakeGraph()));
    const res = await enabledApp().request('/api/v1/m365/connect-url');
    expect(res.status).toBe(401);
  });

  it('returns the Microsoft authorize URL as JSON', async () => {
    setM365Runtime(runtimeForFakeGraph(createFakeGraph()));
    const { adult } = await seedTestHousehold();
    const res = await enabledApp().request('/api/v1/m365/connect-url', {
      headers: authHeaders(adult.jwt),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.url).toContain('/oauth2/v2.0/authorize');
    expect(data.url).toContain('state=');
  });

  it('refuses the maintenance admin', async () => {
    setM365Runtime(runtimeForFakeGraph(createFakeGraph()));
    const { admin } = await seedTestHousehold();
    const res = await enabledApp().request('/api/v1/m365/connect-url', {
      headers: authHeaders(admin.jwt),
    });
    expect(res.status).toBe(403);
  });
});

describe('callback redirects', () => {
  it('redirects to /profile on success', async () => {
    setM365Runtime(runtimeForFakeGraph(createFakeGraph()));
    const { adult } = await seedTestHousehold();
    const state = await signConnectState(adult.user.id);
    const res = await enabledApp().request(`/api/v1/m365/callback?code=good-code&state=${state}`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/profile?connected=m365');
  });

  it('redirects to /profile with a code when consent is denied', async () => {
    setM365Runtime(runtimeForFakeGraph(createFakeGraph()));
    const res = await enabledApp().request('/api/v1/m365/callback?error=access_denied');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/profile?connectError=M365_CONSENT_DENIED');
  });

  it('redirects with M365_STATE_INVALID for a bad state', async () => {
    setM365Runtime(runtimeForFakeGraph(createFakeGraph()));
    const res = await enabledApp().request('/api/v1/m365/callback?code=c&state=not-a-jwt');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/profile?connectError=M365_STATE_INVALID');
  });

  it('redirects with M365_CALLBACK_INVALID when code or state is missing', async () => {
    setM365Runtime(runtimeForFakeGraph(createFakeGraph()));
    const res = await enabledApp().request('/api/v1/m365/callback');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/profile?connectError=M365_CALLBACK_INVALID');
  });
});
```

Use whatever code string `tests/fake-graph.ts` treats as a successful exchange in place of `good-code`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/m365-routes.test.ts`
Expected: FAIL — `/connect-url` 404s and the callback returns JSON errors.

- [ ] **Step 3: Add the route and change the redirects**

In `src/m365/routes.ts`, add the import:

```ts
import { assertNotMaintenanceAdmin } from '../household/maintenance-admin.js';
```

After the existing `/connect` handler:

```ts
/**
 * JSON twin of `/connect`. The web client authenticates with a Bearer token from
 * localStorage, which a top-level browser navigation cannot carry — so the UI
 * fetches the consent URL here and assigns `window.location.href` itself.
 */
m365Router.get('/connect-url', requireAuth, async (c) => {
  const memberId = c.get('auth').userId;
  await assertNotMaintenanceAdmin(memberId);
  const state = await signConnectState(memberId);
  return ok(c, { url: getM365Runtime().delegated.authorizeUrl(state) });
});
```

Rewrite the `/callback` handler's failure and success exits as redirects. Replace each `return err(c, '<CODE>', ...)` with `return c.redirect('/profile?connectError=<CODE>', 302)`, keeping the existing codes (`M365_CONSENT_DENIED`, `M365_CALLBACK_INVALID`, `M365_STATE_INVALID`, `M365_EXCHANGE_FAILED`), and change the success redirect from `/?m365=connected` to `/profile?connected=m365`. Add the admin guard after `verifyConnectState`:

```ts
  await assertNotMaintenanceAdmin(memberId);
```

Only the code crosses the redirect — never exchange error text, which may reference token material.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/m365-routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Full backend verification**

Run: `npm run typecheck && npm run build && npm test`
Expected: all PASS. The backend is now complete.

- [ ] **Step 6: Commit**

```bash
git add src/m365/routes.ts tests/m365-routes.test.ts
git commit -m "feat(m365): add GET /connect-url and redirect the callback to /profile"
```

---

### Task 9: Hide the admin from the web UI

**Files:**
- Modify: `web/src/hooks/use-household.ts:24-26`
- Modify: `web/src/components/calendar/event-form.tsx:56-57`, `web/src/components/dashboard/members-row.tsx:8-9`, `web/src/pages/hearth.tsx:72,82,85`
- Create: `web/src/hooks/use-household-members.test.ts`
- Create: `web/src/components/calendar/event-form.admin.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks (pure frontend).
- Produces: `useHouseholdMembers()` — same return shape as `useMembers()`, with `data.data` filtered to `role !== 'admin'`.

The event form has **no owner field** — its schema carries only `attendeeIds` (`event-form.tsx:25`), and `events.created_by` comes from the authenticated principal server-side. So this is attendee filtering only.

- [ ] **Step 1: Write the failing test**

Create `web/src/hooks/use-household-members.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const useMembersMock = vi.fn();
vi.mock('@/api/household', () => ({ listMembers: vi.fn() }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => useMembersMock() }));

const { useHouseholdMembers } = await import('./use-household');

describe('useHouseholdMembers', () => {
  it('filters out the admin but keeps everyone else', () => {
    useMembersMock.mockReturnValue({
      data: { data: [
        { id: 'a', role: 'admin', displayName: 'Admin' },
        { id: 'b', role: 'adult', displayName: 'Anna' },
        { id: 'c', role: 'child', displayName: 'Kim' },
      ] },
      isError: false,
    });

    const { result } = renderHook(() => useHouseholdMembers());
    expect(result.current.data?.data.map((m) => m.id)).toEqual(['b', 'c']);
  });

  it('survives a not-yet-loaded query', () => {
    useMembersMock.mockReturnValue({ data: undefined, isError: false });
    const { result } = renderHook(() => useHouseholdMembers());
    expect(result.current.data).toBeUndefined();
  });
});
```

Create `web/src/components/calendar/event-form.admin.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import EventForm from './event-form';

vi.mock('@/hooks/use-household', () => ({
  useHouseholdMembers: () => ({
    data: { data: [
      { id: 'b', role: 'adult', displayName: 'Anna', avatarColor: 'sage' },
      { id: 'c', role: 'child', displayName: 'Kim', avatarColor: 'sky' },
    ] },
  }),
}));

describe('EventForm attendees', () => {
  it('never offers the maintenance admin as an attendee', () => {
    render(<EventForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('Anna')).toBeInTheDocument();
    expect(screen.getByText('Kim')).toBeInTheDocument();
    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
  });
});
```

Match `EventForm`'s real required props; add any the component needs.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npm test -- use-household-members event-form.admin`
Expected: FAIL — `useHouseholdMembers` is not exported.

- [ ] **Step 3: Add the hook**

In `web/src/hooks/use-household.ts`, after `useMembers`:

```ts
/**
 * Members for daily business — the maintenance admin excluded.
 *
 * The admin is a maintenance login, not a household person: it may not own or be
 * assigned anything (the server enforces this too). Use this everywhere EXCEPT the
 * household members table and the admin connections overview, which need the raw
 * `useMembers()`.
 */
export function useHouseholdMembers() {
  const query = useMembers();
  const data = query.data
    ? { ...query.data, data: query.data.data.filter((m) => m.role !== 'admin') }
    : undefined;
  return { ...query, data } as typeof query;
}
```

- [ ] **Step 4: Switch the three call sites**

In `web/src/components/calendar/event-form.tsx`, `web/src/components/dashboard/members-row.tsx`, and `web/src/pages/hearth.tsx`, change the import and call from `useMembers` to `useHouseholdMembers`. Leave `web/src/pages/household.tsx` on `useMembers` — the members table must still show the admin.

In `hearth.tsx`, keep the `membersById` lookup tolerant of a missing key so a pre-existing admin-owned event still renders rather than crashing.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd web && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/hooks/use-household.ts web/src/components/ web/src/pages/hearth.tsx
git commit -m "feat(web): exclude the maintenance admin from household member surfaces"
```

---

### Task 10: M365 API client and the provider registry

**Files:**
- Modify: `web/src/api/m365.ts`
- Create: `web/src/hooks/use-m365.ts`
- Create: `web/src/lib/providers.ts`
- Modify: `web/src/lib/constants.ts`
- Modify: `web/src/i18n/locales/en.json`, `web/src/i18n/locales/de.json`

**Interfaces:**
- Consumes: `GET /m365/connect-url`, `DELETE /m365/connection`, `GET /m365/status` (Task 8).
- Produces, from `web/src/api/m365.ts`:
  ```ts
  export interface M365Connection {
    memberId: string; accountUpn: string; status: string;
    lastRefreshSuccessAt: string | null; lastRefreshError: string | null;
  }
  export function getM365ConnectUrl(): Promise<SingleResponse<{ url: string }>>
  export function disconnectM365(): Promise<SingleResponse<{ disconnected: boolean }>>
  ```
- Produces, from `web/src/hooks/use-m365.ts` (its own module so Task 13 can mock it
  independently of the registry):
  ```ts
  export type ProviderState = 'unavailable' | 'disconnected' | 'connected' | 'needs_reauth';
  /** Raw query — the admin panel needs `connections` and `feeds` too. */
  export function useM365Status(): UseQueryResult<SingleResponse<M365Status>>
  /** Derived per-member view used by the provider registry. */
  export function useM365ProviderStatus(): {
    state: ProviderState; connection: M365Connection | null; isLoading: boolean;
  }
  ```
- Produces, from `web/src/lib/providers.ts`:
  ```ts
  export type ProviderConnection = M365Connection;   // registry-level alias
  export interface ProviderApi {
    useStatus: () => { state: ProviderState; connection: ProviderConnection | null; isLoading: boolean };
    getConnectUrl: () => Promise<string>;
    disconnect: () => Promise<void>;
  }
  export interface ConnectionProvider {
    id: string; nameKey: string; descriptionKey: string;
    capabilities: ('calendar' | 'tasks')[]; icon: LucideIcon; api: ProviderApi;
  }
  export const PROVIDERS: ConnectionProvider[]
  ```
  `ProviderState` is re-exported from `providers.ts` so Task 11 imports its types from
  one place.

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/providers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { PROVIDERS } from './providers';

describe('PROVIDERS registry', () => {
  it('registers Microsoft 365 with its capabilities', () => {
    const m365 = PROVIDERS.find((p) => p.id === 'm365');
    expect(m365).toBeDefined();
    expect(m365!.capabilities).toEqual(['calendar', 'tasks']);
  });

  it('gives every provider the full API surface', () => {
    for (const p of PROVIDERS) {
      expect(typeof p.api.useStatus).toBe('function');
      expect(typeof p.api.getConnectUrl).toBe('function');
      expect(typeof p.api.disconnect).toBe('function');
      expect(p.nameKey).toBeTruthy();
      expect(p.descriptionKey).toBeTruthy();
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npm test -- providers`
Expected: FAIL — cannot resolve `./providers`.

- [ ] **Step 3: Extend the API client**

In `web/src/api/m365.ts`, add:

```ts
import { apiGet, apiDelete } from './client';

export interface M365Connection {
  memberId: string;
  accountUpn: string;
  status: string;
  lastRefreshSuccessAt: string | null;
  lastRefreshError: string | null;
}

/** The consent URL, fetched as JSON because a browser navigation cannot carry the Bearer token. */
export function getM365ConnectUrl(): Promise<SingleResponse<{ url: string }>> {
  return apiGet('/m365/connect-url');
}

export function disconnectM365(): Promise<SingleResponse<{ disconnected: boolean }>> {
  return apiDelete('/m365/connection');
}
```

Widen `M365Status` so `connection` is `M365Connection | null` and `connections` is `M365Connection[]`, replacing the two `unknown`s.

- [ ] **Step 4: Write the status hooks**

Create `web/src/hooks/use-m365.ts`. `useM365Status()` is the raw query (Task 13's admin panel needs `connections` and `feeds`); `useM365ProviderStatus()` derives the per-member view and must map a **404 to `'unavailable'`** — the documented disabled-integration behaviour — never surfacing it as an error:

```ts
export function useM365Status() {
  return useQuery({
    queryKey: QUERY_KEYS.m365Status,
    queryFn: getM365Status,
    retry: false,
  });
}

export function useM365ProviderStatus() {
  const query = useM365Status();

  // A 404 means the integration is disabled server-side (the routes are not
  // mounted at all). That is "not available", never an error worth a toast.
  const notMounted = query.error instanceof ApiError && query.error.status === 404;
  const connection = query.data?.data.connection ?? null;

  const state: ProviderState = notMounted
    ? 'unavailable'
    : !connection
      ? 'disconnected'
      : connection.status === 'active'
        ? 'connected'
        : 'needs_reauth';

  return { state, connection, isLoading: query.isLoading };
}
```

Add `m365Status: ['m365', 'status'] as const` to `QUERY_KEYS` in `web/src/lib/constants.ts`.

Then create `web/src/lib/providers.ts` with the `ProviderConnection` / `ProviderApi` / `ConnectionProvider` types above, re-exporting `ProviderState`, and a single `m365` entry whose `api` is `{ useStatus: useM365ProviderStatus, getConnectUrl, disconnect }` — `getConnectUrl` unwrapping `getM365ConnectUrl()` to the bare `url` string, and `disconnect` wrapping `disconnectM365()`.

- [ ] **Step 5: Add the i18n keys**

Add a `connections` block to both `web/src/i18n/locales/en.json` and `de.json` — provider names and descriptions, the four state labels, `connect` / `disconnect` / `reconnect` actions, capability labels (`calendar`, `tasks`), the connect/disconnect toasts, and one message per `connectError` code. Both files must gain the same key set; a key present in only one is a bug.

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd web && npm test -- providers`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/src/api/m365.ts web/src/lib/ web/src/i18n/
git commit -m "feat(web): add the M365 connect/disconnect client and the provider registry"
```

---

### Task 11: The provider card

**Files:**
- Create: `web/src/components/profile/provider-card.tsx`
- Create: `web/src/components/profile/provider-card.test.tsx`

**Interfaces:**
- Consumes: `ConnectionProvider`, `ProviderState` (Task 10).
- Produces: `<ProviderCard provider={p} />` — renders one registry entry and owns all four states.

- [ ] **Step 1: Write the failing test**

Create `web/src/components/profile/provider-card.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import ProviderCard from './provider-card';
import type { ConnectionProvider, ProviderState } from '@/lib/providers';
import { Plug } from 'lucide-react';

afterEach(cleanup);

const getConnectUrl = vi.fn();
const disconnect = vi.fn();

function providerIn(state: ProviderState, connection: unknown = null): ConnectionProvider {
  return {
    id: 'm365', nameKey: 'connections.m365.name', descriptionKey: 'connections.m365.description',
    capabilities: ['calendar', 'tasks'], icon: Plug,
    api: {
      useStatus: () => ({ state, connection: connection as never, isLoading: false }),
      getConnectUrl, disconnect,
    },
  };
}

describe('ProviderCard', () => {
  it('offers no action when the integration is unavailable', () => {
    render(<ProviderCard provider={providerIn('unavailable')} />);
    expect(screen.queryByRole('button', { name: /connect/i })).not.toBeInTheDocument();
  });

  it('offers Connect when disconnected', () => {
    render(<ProviderCard provider={providerIn('disconnected')} />);
    expect(screen.getByRole('button', { name: /connect/i })).toBeInTheDocument();
  });

  it('shows the account and offers Disconnect when connected', () => {
    render(<ProviderCard provider={providerIn('connected', {
      memberId: 'b', accountUpn: 'anna@example.com', status: 'active',
      lastRefreshSuccessAt: '2026-08-04T10:00:00Z', lastRefreshError: null,
    })} />);
    expect(screen.getByText('anna@example.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /disconnect/i })).toBeInTheDocument();
  });

  it('offers Reconnect and shows the error when re-auth is needed', () => {
    render(<ProviderCard provider={providerIn('needs_reauth', {
      memberId: 'b', accountUpn: 'anna@example.com', status: 'needs_reauth',
      lastRefreshSuccessAt: null, lastRefreshError: 'invalid_grant',
    })} />);
    expect(screen.getByRole('button', { name: /reconnect/i })).toBeInTheDocument();
    expect(screen.getByText(/invalid_grant/)).toBeInTheDocument();
  });

  it('navigates to the consent URL on Connect', async () => {
    getConnectUrl.mockResolvedValue('https://login.microsoftonline.com/authorize?x=1');
    const assign = vi.fn();
    Object.defineProperty(window, 'location', { value: { assign, href: '' }, writable: true });

    render(<ProviderCard provider={providerIn('disconnected')} />);
    fireEvent.click(screen.getByRole('button', { name: /connect/i }));

    await waitFor(() => expect(getConnectUrl).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npm test -- provider-card`
Expected: FAIL — cannot resolve `./provider-card`.

- [ ] **Step 3: Implement the card**

Create `web/src/components/profile/provider-card.tsx`. It takes `{ provider }`, calls `provider.api.useStatus()`, and renders name/description from `t(provider.nameKey)` / `t(provider.descriptionKey)`, capability chips, a status dot, and the state-appropriate action. `Connect` and `Reconnect` both `await provider.api.getConnectUrl()` then assign `window.location.href`; `Disconnect` calls `provider.api.disconnect()`, invalidates the status query, and toasts. Follow the existing Card/Button/Badge primitives in `web/src/components/ui/` and the toast pattern from `web/src/pages/household.tsx`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npm test -- provider-card`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/profile/
git commit -m "feat(web): add the provider card with its four connection states"
```

---

### Task 12: The `/profile` page

**Files:**
- Create: `web/src/pages/profile.tsx`
- Create: `web/src/pages/profile.test.tsx`
- Modify: `web/src/app.tsx:71-89`, `web/src/components/layout/top-bar.tsx:16-22`, `web/src/components/layout/app-shell.tsx:9-19`

**Interfaces:**
- Consumes: `PROVIDERS` (Task 10), `ProviderCard` (Task 11), the callback redirect params (Task 8).
- Produces: a `/profile` route reachable from the top bar.

- [ ] **Step 1: Write the failing test**

Create `web/src/pages/profile.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import ProfilePage from './profile';

const toast = vi.fn();
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/profile/provider-card', () => ({
  default: ({ provider }: { provider: { id: string } }) => <div>card:{provider.id}</div>,
}));

afterEach(() => { cleanup(); toast.mockClear(); });

describe('ProfilePage', () => {
  it('renders a card per registered provider', () => {
    render(<ProfilePage />);
    expect(screen.getByText('card:m365')).toBeInTheDocument();
  });

  it('turns ?connected=m365 into a success toast and clears the param', async () => {
    window.history.replaceState({}, '', '/profile?connected=m365');
    render(<ProfilePage />);
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.any(String), 'success'));
    expect(window.location.search).toBe('');
  });

  it('turns ?connectError= into an error toast and clears the param', async () => {
    window.history.replaceState({}, '', '/profile?connectError=M365_CONSENT_DENIED');
    render(<ProfilePage />);
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.any(String), 'error'));
    expect(window.location.search).toBe('');
  });

  it('does not toast on a plain visit', async () => {
    window.history.replaceState({}, '', '/profile');
    render(<ProfilePage />);
    await waitFor(() => expect(toast).not.toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npm test -- profile`
Expected: FAIL — cannot resolve `./profile`.

- [ ] **Step 3: Build the page**

Create `web/src/pages/profile.tsx`: a "Connected accounts" heading and `PROVIDERS.map((p) => <ProviderCard key={p.id} provider={p} />)`. In a `useEffect`, read `connected` / `connectError` from `window.location.search`, raise the matching toast (translating the error code through the `connections.errors.*` keys added in Task 10, with a generic fallback for an unknown code), then strip the params with `window.history.replaceState` so a reload does not re-toast.

If the session is the maintenance admin (`useWhoami()` → `role === 'admin'` **and** the members list marks it as the admin account), render the explanatory card instead of the provider list — the server would 403 the connect anyway.

- [ ] **Step 4: Wire the route and the entry point**

In `web/src/app.tsx`: import `ProfilePage`, add
`const profileRoute = createRoute({ getParentRoute: () => authRoute, path: '/profile', component: ProfilePage });`
and include `profileRoute` in `authRoute.addChildren([...])`.

In `web/src/components/layout/app-shell.tsx`, add `'/profile': 'nav.profile'` to `PAGE_TITLES` and `'nav.profile'` to the `NavLabelKey` union; add the `nav.profile` key to both locale files. Do **not** add `/profile` to `NAV_ITEMS` — the entry point is the top bar.

In `web/src/components/layout/top-bar.tsx`, wrap the avatar and display name in `<Link to="/profile">`, leaving the sign-out button as it is.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd web && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/profile.tsx web/src/pages/profile.test.tsx web/src/app.tsx web/src/components/layout/ web/src/i18n/
git commit -m "feat(web): add the /profile page with connected accounts"
```

---

### Task 13: The admin connections overview

**Files:**
- Create: `web/src/components/household/connections-panel.tsx`
- Create: `web/src/components/household/connections-panel.test.tsx`
- Modify: `web/src/pages/household.tsx:72-102`

**Interfaces:**
- Consumes: `getM365Status` and `M365Connection` (Task 10), `useMembers` (raw — the admin join needs every member).
- Produces: a Connections tab rendered only for `whoami.role === 'admin'`.

- [ ] **Step 1: Write the failing test**

Create `web/src/components/household/connections-panel.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import ConnectionsPanel from './connections-panel';

const syncNow = vi.fn();
vi.mock('@/hooks/use-household', () => ({
  useMembers: () => ({ data: { data: [
    { id: 'a', role: 'admin', displayName: 'Admin' },
    { id: 'b', role: 'adult', displayName: 'Anna' },
  ] } }),
}));
vi.mock('@/api/m365', () => ({
  getM365Status: vi.fn(),
  triggerM365Sync: (...args: unknown[]) => syncNow(...args),
}));
vi.mock('@/hooks/use-m365', () => ({
  useM365Status: () => ({
    data: { data: {
      connections: [{
        memberId: 'b', accountUpn: 'anna@example.com', status: 'active',
        lastRefreshSuccessAt: '2026-08-04T10:00:00Z', lastRefreshError: null,
      }],
      feeds: [
        { feedKey: 'calendar:member:b', lastSuccessAt: '2026-08-04T10:00:00Z', lastError: null, consecutiveFailures: 0, updatedAt: '' },
        { feedKey: 'todo:member:b:list1', lastSuccessAt: null, lastError: 'needs_reauth', consecutiveFailures: 3, updatedAt: '' },
      ],
    } },
    isLoading: false,
  }),
}));

afterEach(cleanup);

describe('ConnectionsPanel', () => {
  it('shows the connection against its member display name', () => {
    render(<ConnectionsPanel />);
    expect(screen.getByText('Anna')).toBeInTheDocument();
    expect(screen.getByText('anna@example.com')).toBeInTheDocument();
  });

  it('lists every feed and flags the failing one', () => {
    render(<ConnectionsPanel />);
    expect(screen.getByText('calendar:member:b')).toBeInTheDocument();
    expect(screen.getByText('todo:member:b:list1')).toBeInTheDocument();
    expect(screen.getByText(/needs_reauth/)).toBeInTheDocument();
  });

  it('triggers a manual sync', async () => {
    syncNow.mockResolvedValue({ data: { results: [] } });
    render(<ConnectionsPanel />);
    fireEvent.click(screen.getByRole('button', { name: /sync/i }));
    await waitFor(() => expect(syncNow).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npm test -- connections-panel`
Expected: FAIL — cannot resolve `./connections-panel`.

- [ ] **Step 3: Build the panel**

Add `triggerM365Sync()` (`POST /m365/sync`) to `web/src/api/m365.ts`. Create `connections-panel.tsx` with the three sections from the spec: the connections table joined to `useMembers()` for display names (members without a connection are not listed), the feed-health table with `consecutiveFailures > 0` visually flagged, and a "Sync now" button that calls `triggerM365Sync()`, toasts the result summary, and invalidates the status query. Add the i18n keys to both locale files.

- [ ] **Step 4: Add the tab**

In `web/src/pages/household.tsx`, add a fourth `TabsTrigger` / `TabsContent` for `connections`, both rendered only when `canManage` is true. Gate the API Keys and Settings tabs on `canManage` as well, so non-admins see only Members.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd web && npm test`
Expected: PASS.

- [ ] **Step 6: Full verification**

```bash
npm run typecheck && npm run build && npm test
cd web && npm test && npm run build
```
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/household/ web/src/pages/household.tsx web/src/api/m365.ts web/src/i18n/
git commit -m "feat(web): add the admin household connections overview"
```

---

## Verification Checklist

- [ ] `npm run typecheck && npm run build` clean
- [ ] `npm test` green (backend, against a `_test` database)
- [ ] `cd web && npm test && npm run build` green
- [ ] `/profile` reachable from the top bar; Connect redirects to Microsoft consent
- [ ] Callback returns to `/profile` with a toast on both success and failure
- [ ] The admin appears in Household → Members and **nowhere else** in the UI
- [ ] The admin is refused as event attendee/creator, recipe creator, cook, helper, To Do allowlist owner, library connection owner, and Feoh actor — via REST **and** MCP
- [ ] `DELETE` / role change / email change on the admin all return `403 ADMIN_PROTECTED`
- [ ] Rotating `ADMIN_EMAIL` and restarting updates the existing admin in place and creates no second account

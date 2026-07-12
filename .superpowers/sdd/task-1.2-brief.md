### Task 1.2: Household, members & auth REST routes + module registration

**Files:**
- Create: `src/household/routes.ts`, `src/household/index.ts`
- Modify: `src/modules/index.ts` (add `householdModule` to `ALL_MODULES`); `src/db/schema/index.ts` & `drizzle-schema.ts` (no new tables — comment only)
- Test: `tests/household-routes.test.ts`

**Interfaces:**
- Consumes: household service (Task 1.1), core `ok`/`err`, `requireAuth`/`requireJwt`/`requireRole`, `rateLimit`, `parsePagination`, `logEvent`, `HeorthModule`/`McpRegistry`.
- Produces: `householdModule: HeorthModule`; REST under `/api/v1/household`, `/api/v1/members`, `/api/v1/auth`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/household-routes.test.ts
import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app.js';
import { householdModule } from '../src/household/index.js';
import { seedTestHousehold, authHeaders } from './helpers.js';

const app = createApp([householdModule]);

describe('household & members routes', () => {
  it('lists members for any authenticated role', async () => {
    const { child } = await seedTestHousehold();
    const res = await app.request('/api/v1/members', { headers: authHeaders(child.jwt) });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(body.data.length).toBe(3);
  });

  it('admin can create a member; adult and child get 403', async () => {
    const { admin, adult, child } = await seedTestHousehold();
    const payload = JSON.stringify({
      email: 'kid2@test.local', password: 'pw-kid2-12', displayName: 'Kid Two',
      avatarColor: 'ember', role: 'child',
    });

    const adminRes = await app.request('/api/v1/members', { method: 'POST', headers: authHeaders(admin.jwt), body: payload });
    expect(adminRes.status).toBe(201);

    const adultRes = await app.request('/api/v1/members', { method: 'POST', headers: authHeaders(adult.jwt), body: payload });
    expect(adultRes.status).toBe(403);

    const childRes = await app.request('/api/v1/members', { method: 'POST', headers: authHeaders(child.jwt), body: payload });
    expect(childRes.status).toBe(403);
  });

  it('admin can assign a role; non-admins cannot', async () => {
    const { admin, adult } = await seedTestHousehold();
    const ok = await app.request(`/api/v1/members/${adult.user.id}/role`, {
      method: 'PATCH', headers: authHeaders(admin.jwt), body: JSON.stringify({ role: 'admin' }),
    });
    expect(ok.status).toBe(200);
    const forbidden = await app.request(`/api/v1/members/${adult.user.id}/role`, {
      method: 'PATCH', headers: authHeaders(adult.jwt), body: JSON.stringify({ role: 'child' }),
    });
    expect(forbidden.status).toBe(403);
  });

  it('a member can PATCH their own profile but not another member', async () => {
    const { adult, child } = await seedTestHousehold();
    const self = await app.request(`/api/v1/members/${adult.user.id}`, {
      method: 'PATCH', headers: authHeaders(adult.jwt), body: JSON.stringify({ displayName: 'Grown Up' }),
    });
    expect(self.status).toBe(200);
    const other = await app.request(`/api/v1/members/${child.user.id}`, {
      method: 'PATCH', headers: authHeaders(adult.jwt), body: JSON.stringify({ displayName: 'Hacked' }),
    });
    expect(other.status).toBe(403);
  });

  it('logs in and returns a token; whoami reflects the caller', async () => {
    await seedTestHousehold();
    const login = await app.request('/api/v1/auth/token', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@test.local', password: 'test-admin-password' }),
    });
    expect(login.status).toBe(200);
    const { data } = await login.json() as { data: { token: string } };
    const who = await app.request('/api/v1/auth/whoami', {
      headers: { Authorization: `Bearer ${data.token}` },
    });
    expect(who.status).toBe(200);
    const whoBody = await who.json() as { data: { email: string; role: string } };
    expect(whoBody.data.email).toBe('admin@test.local');
    expect(whoBody.data.role).toBe('admin');
  });

  it('key-management rejects API-key auth (JWT only)', async () => {
    const { admin } = await seedTestHousehold();
    const created = await app.request('/api/v1/auth/keys', {
      method: 'POST', headers: authHeaders(admin.jwt), body: JSON.stringify({ name: 'agent' }),
    });
    expect(created.status).toBe(201);
    const { data } = await created.json() as { data: { key: string } };
    expect(data.key.startsWith('he_')).toBe(true);

    // Using the raw API key against a JWT-only route must fail.
    const withKey = await app.request('/api/v1/auth/keys', {
      headers: { Authorization: `Bearer ${data.key}` },
    });
    expect(withKey.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/household-routes.test.ts`
Expected: FAIL — `householdModule` not found.

- [ ] **Step 3: Write `src/household/routes.ts`**

```ts
import { Hono } from 'hono';
import { ok, err, rateLimit } from '@wyrhta/core/http';
import { requireAuth, requireJwt, requireRole } from '@wyrhta/core/auth';
import { logEvent } from '@wyrhta/core/lib';
import * as service from './service.js';
import { identityService } from './service.js';
import {
  createMemberSchema, updateMemberSchema, setRoleSchema,
  updateHouseholdSchema, loginSchema, createKeySchema,
} from './validators.js';

export const householdRouter = new Hono();
householdRouter.get('/', requireAuth, async (c) => {
  const h = await service.getHousehold();
  if (!h) return err(c, 'NOT_FOUND', 'Household not seeded', 404);
  return ok(c, h);
});
householdRouter.patch('/', requireRole('admin'), async (c) => {
  const body = updateHouseholdSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  const h = await service.updateHousehold(body.data);
  return ok(c, h);
});

export const membersRouter = new Hono();
membersRouter.use('*', requireAuth);

membersRouter.get('/', async (c) => {
  const members = await service.listMembers();
  return ok(c, members, { total: members.length });
});

membersRouter.post('/', requireRole('admin'), async (c) => {
  const body = createMemberSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  try {
    const member = await service.createMember(body.data);
    logEvent({ event: 'member.created', member_id: member.id, request_id: c.get('requestId') });
    return ok(c, member, undefined, 201);
  } catch (e: unknown) {
    if (e instanceof Error && e.message === 'EMAIL_TAKEN') {
      return err(c, 'CONFLICT', 'A member with that email already exists', 409);
    }
    throw e;
  }
});

membersRouter.get('/:id', async (c) => {
  const member = await service.getMember(c.req.param('id'));
  if (!member) return err(c, 'NOT_FOUND', 'Member not found', 404);
  return ok(c, member);
});

membersRouter.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const auth = c.get('auth');
  if (auth.role !== 'admin' && auth.userId !== id) {
    return err(c, 'FORBIDDEN', 'You may only edit your own profile', 403);
  }
  const body = updateMemberSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  const member = await service.updateMember(id, body.data);
  if (!member) return err(c, 'NOT_FOUND', 'Member not found', 404);
  return ok(c, member);
});

membersRouter.patch('/:id/role', requireRole('admin'), async (c) => {
  const body = setRoleSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  const member = await service.setMemberRole(c.req.param('id'), body.data.role);
  if (!member) return err(c, 'NOT_FOUND', 'Member not found', 404);
  logEvent({ event: 'member.role_changed', member_id: member.id, role: body.data.role, request_id: c.get('requestId') });
  return ok(c, member);
});

membersRouter.delete('/:id', requireRole('admin'), async (c) => {
  try {
    const member = await service.deleteMember(c.req.param('id'), c.get('auth').userId);
    if (!member) return err(c, 'NOT_FOUND', 'Member not found', 404);
    return ok(c, { id: member.id });
  } catch (e: unknown) {
    if (e instanceof Error && e.message === 'CANNOT_DELETE_SELF') return err(c, 'FORBIDDEN', 'You cannot delete yourself', 403);
    if (e instanceof Error && e.message === 'LAST_ADMIN') return err(c, 'CONFLICT', 'Cannot remove the last admin', 409);
    throw e;
  }
});

export const authRouter = new Hono();

authRouter.post('/token', rateLimit(), async (c) => {
  const body = loginSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  const result = await service.login(body.data.email, body.data.password);
  if (!result) {
    logEvent({ event: 'auth.token.failure', email: body.data.email, request_id: c.get('requestId') });
    return err(c, 'UNAUTHORIZED', 'Invalid email or password', 401);
  }
  logEvent({ event: 'auth.token.success', member_id: result.user.id, request_id: c.get('requestId') });
  return ok(c, { token: result.token, expires_in: result.expiresIn });
});

authRouter.get('/whoami', requireAuth, async (c) => {
  const member = await service.getMember(c.get('auth').userId);
  if (!member) return err(c, 'NOT_FOUND', 'Member not found', 404);
  return ok(c, member);
});

authRouter.get('/keys', requireJwt, async (c) => {
  const keys = await identityService.listApiKeys(c.get('auth').userId);
  return ok(c, keys);
});

authRouter.post('/keys', requireJwt, async (c) => {
  const body = createKeySchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  const key = await identityService.createApiKey(c.get('auth').userId, body.data.name, 'he_');
  logEvent({ event: 'auth.key.created', key_id: key.id, member_id: c.get('auth').userId, request_id: c.get('requestId') });
  return ok(c, key, undefined, 201);
});

authRouter.delete('/keys/:id', requireJwt, async (c) => {
  const revoked = await identityService.revokeApiKey(c.req.param('id'));
  if (!revoked) return err(c, 'NOT_FOUND', 'API key not found', 404);
  logEvent({ event: 'auth.key.revoked', key_id: revoked.id, request_id: c.get('requestId') });
  return ok(c, { id: revoked.id });
});
```

- [ ] **Step 4: Write `src/household/index.ts`**

```ts
import type { Hono } from 'hono';
import type { HeorthModule, McpRegistry } from '../modules/registry.js';
import { householdRouter, membersRouter, authRouter } from './routes.js';
import { householdTools } from './mcp.js';

export const householdModule: HeorthModule = {
  name: 'household',
  register(app: Hono, mcp: McpRegistry): void {
    app.route('/api/v1/household', householdRouter);
    app.route('/api/v1/members', membersRouter);
    app.route('/api/v1/auth', authRouter);
    mcp.add(...householdTools);
  },
};
```

> `./mcp.js` (`householdTools`) is created in Task 1.3. To make this task compile and pass on its own, create a placeholder now and flesh it out next: `export const householdTools = [];` in `src/household/mcp.ts`.

- [ ] **Step 5: Create the temporary MCP placeholder and register the module**

Create `src/household/mcp.ts`:
```ts
import type { McpTool } from '@wyrhta/core/mcp';
export const householdTools: McpTool[] = [];
```

Modify `src/modules/index.ts`:
```ts
import type { HeorthModule } from './registry.js';
import { householdModule } from '../household/index.js';

export const ALL_MODULES: HeorthModule[] = [
  householdModule,
];
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- tests/household-routes.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 7: Commit**

```bash
git add src/household/routes.ts src/household/index.ts src/household/mcp.ts src/modules/index.ts tests/household-routes.test.ts
git commit -m "feat: add household/members/auth REST routes with role guards and register the module"
```

---


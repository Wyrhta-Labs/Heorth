### Task 1.1: Household service, validators & shared test helpers

**Files:**
- Create: `src/household/validators.ts`, `src/household/service.ts`, `tests/helpers.ts`
- Test: `tests/household-service.test.ts`

**Interfaces:**
- Consumes: `createIdentityService`, `createHouseholdService`, `household` table, `config`.
- Produces:
  - Validators: `createMemberSchema`, `updateMemberSchema`, `setRoleSchema`, `updateHouseholdSchema`, `loginSchema`, `createKeySchema`; types `CreateMemberInput`, `UpdateMemberInput`, `SetRoleInput`, `UpdateHouseholdInput`; `AVATAR_COLORS`.
  - Service functions: `getHousehold()`, `updateHousehold(input)`, `listMembers()`, `getMember(id)`, `createMember(input)` (throws `'EMAIL_TAKEN'`), `updateMember(id, input)`, `setMemberRole(id, role)`, `deleteMember(id, actingUserId)` (throws `'CANNOT_DELETE_SELF'`, `'LAST_ADMIN'`), `login(email, password)`.
  - Test helpers: `seedTestHousehold()`, `authHeaders(jwt)`, `SeededMember`.

- [ ] **Step 1: Write `src/household/validators.ts`**

```ts
import { z } from 'zod';

export const AVATAR_COLORS = ['ember', 'taupe', 'sage', 'sky'] as const;

export const createMemberSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(1),
  avatarColor: z.enum(AVATAR_COLORS),
  role: z.enum(['adult', 'child']).default('adult'),
  handle: z.string().min(1).optional(),
});

export const updateMemberSchema = z.object({
  displayName: z.string().min(1).optional(),
  avatarColor: z.enum(AVATAR_COLORS).optional(),
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
});

export const setRoleSchema = z.object({
  role: z.enum(['admin', 'adult', 'child']),
});

export const updateHouseholdSchema = z.object({
  name: z.string().min(1).optional(),
  timezone: z.string().min(1).optional(),
  locale: z.string().min(1).optional(),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const createKeySchema = z.object({
  name: z.string().min(1),
});

export type CreateMemberInput = z.infer<typeof createMemberSchema>;
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;
export type SetRoleInput = z.infer<typeof setRoleSchema>;
export type UpdateHouseholdInput = z.infer<typeof updateHouseholdSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateKeyInput = z.infer<typeof createKeySchema>;
```

- [ ] **Step 2: Write `src/household/service.ts`**

```ts
import { db } from '../db/index.js';
import { household } from '@wyrhta/core/household';
import { createHouseholdService } from '@wyrhta/core/household';
import { createIdentityService } from '@wyrhta/core/identity';
import type { Role } from '@wyrhta/core/identity';
import { config } from '../config/env.js';
import type { CreateMemberInput, UpdateMemberInput, UpdateHouseholdInput } from './validators.js';

const identity = createIdentityService(db);
const core = createHouseholdService(db, identity);

export function getHousehold() {
  return core.getHousehold();
}

export async function updateHousehold(input: UpdateHouseholdInput) {
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch['name'] = input.name;
  if (input.timezone !== undefined) patch['timezone'] = input.timezone;
  if (input.locale !== undefined) patch['locale'] = input.locale;
  if (Object.keys(patch).length === 0) return core.getHousehold();
  const [row] = await db.update(household).set(patch).returning();
  return row ?? null;
}

export function listMembers() {
  return core.listMembers();
}

export function getMember(id: string) {
  return identity.getUser(id);
}

export async function createMember(input: CreateMemberInput) {
  try {
    return await identity.createUser({
      email: input.email,
      password: input.password,
      role: input.role,
      displayName: input.displayName,
      avatarColor: input.avatarColor,
      handle: input.handle,
    });
  } catch (e: unknown) {
    if (e && typeof e === 'object' && 'code' in e && (e as { code?: string }).code === '23505') {
      throw new Error('EMAIL_TAKEN');
    }
    throw e;
  }
}

export function updateMember(id: string, input: UpdateMemberInput) {
  return identity.updateUser(id, input);
}

export function setMemberRole(id: string, role: Role) {
  return core.setRole(id, role);
}

export async function deleteMember(id: string, actingUserId: string) {
  if (id === actingUserId) throw new Error('CANNOT_DELETE_SELF');
  const members = await core.listMembers();
  const target = members.find((m) => m.id === id);
  if (!target) return null;
  if (target.role === 'admin' && members.filter((m) => m.role === 'admin').length <= 1) {
    throw new Error('LAST_ADMIN');
  }
  return identity.deleteUser(id);
}

export async function login(email: string, password: string) {
  const user = await identity.authenticate(email, password);
  if (!user) return null;
  const token = await identity.issueToken(user, config.jwtTtlSeconds, config.jwtSecret);
  return { token, user, expiresIn: config.jwtTtlSeconds };
}

export const identityService = identity;
```

- [ ] **Step 3: Write `tests/helpers.ts`**

```ts
import { sign } from 'hono/jwt';
import { db } from '../src/db/index.js';
import { config } from '../src/config/env.js';
import { createIdentityService } from '@wyrhta/core/identity';
import { createHouseholdService } from '@wyrhta/core/household';
import type { User } from '@wyrhta/core/identity';

const identity = createIdentityService(db);
const household = createHouseholdService(db, identity);

export interface SeededMember {
  user: User;
  jwt: string;
}

async function jwtFor(user: User): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign({ sub: user.id, role: user.role, iat: now, exp: now + 3600 }, config.jwtSecret);
}

/** Seed the household + an admin, plus one adult and one child member, with JWTs. */
export async function seedTestHousehold(): Promise<{
  admin: SeededMember;
  adult: SeededMember;
  child: SeededMember;
}> {
  const { admin } = await household.seedHousehold({
    name: 'Test Household',
    adminEmail: 'admin@test.local',
    adminPassword: 'test-admin-password',
    adminDisplayName: 'Admin',
  });
  const adultUser = await identity.createUser({
    email: 'adult@test.local', password: 'pw-adult-1', role: 'adult',
    displayName: 'Adult', avatarColor: 'sage',
  });
  const childUser = await identity.createUser({
    email: 'child@test.local', password: 'pw-child-1', role: 'child',
    displayName: 'Child', avatarColor: 'sky',
  });
  return {
    admin: { user: admin, jwt: await jwtFor(admin) },
    adult: { user: adultUser, jwt: await jwtFor(adultUser) },
    child: { user: childUser, jwt: await jwtFor(childUser) },
  };
}

export function authHeaders(jwt: string): Record<string, string> {
  return { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' };
}
```

- [ ] **Step 4: Write the failing test**

```ts
// tests/household-service.test.ts
import { describe, it, expect } from 'vitest';
import { seedTestHousehold } from './helpers.js';
import * as service from '../src/household/service.js';

describe('household service', () => {
  it('seeds a household and lists three members', async () => {
    await seedTestHousehold();
    const members = await service.listMembers();
    expect(members.length).toBe(3);
    expect(members.filter((m) => m.role === 'admin').length).toBe(1);
  });

  it('creates a member and rejects a duplicate email', async () => {
    await seedTestHousehold();
    const created = await service.createMember({
      email: 'new@test.local', password: 'pw-new-12', displayName: 'New',
      avatarColor: 'ember', role: 'adult',
    });
    expect(created.email).toBe('new@test.local');
    await expect(
      service.createMember({
        email: 'new@test.local', password: 'pw-new-12', displayName: 'Dup',
        avatarColor: 'taupe', role: 'child',
      }),
    ).rejects.toThrow('EMAIL_TAKEN');
  });

  it('promotes a member role', async () => {
    const { adult } = await seedTestHousehold();
    const updated = await service.setMemberRole(adult.user.id, 'admin');
    expect(updated?.role).toBe('admin');
  });

  it('refuses to delete the last admin and refuses self-deletion', async () => {
    const { admin, adult } = await seedTestHousehold();
    await expect(service.deleteMember(admin.user.id, adult.user.id)).rejects.toThrow('LAST_ADMIN');
    await expect(service.deleteMember(adult.user.id, adult.user.id)).rejects.toThrow('CANNOT_DELETE_SELF');
  });

  it('logs in with correct credentials and returns a token', async () => {
    await seedTestHousehold();
    const result = await service.login('admin@test.local', 'test-admin-password');
    expect(result?.token).toBeTruthy();
    const bad = await service.login('admin@test.local', 'wrong');
    expect(bad).toBeNull();
  });
});
```

- [ ] **Step 5: Run test to verify it fails, then passes**

Run: `npm test -- tests/household-service.test.ts`
Expected: FAIL first (service not implemented), then after Steps 1-3 exist, PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/household/validators.ts src/household/service.ts tests/helpers.ts tests/household-service.test.ts
git commit -m "feat: add household/members service, validators, and shared test helpers"
```

---


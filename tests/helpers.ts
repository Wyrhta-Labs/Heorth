import { sign } from 'hono/jwt';
import { config } from '../src/config/env.js';
import { identity, householdCore } from '../src/wiring.js';
import { registerProvider } from '../src/integrations/registry.js';
import { IntegrationStore } from '../src/integrations/store.js';
import type { TaskProvider } from '../src/modules/tasks/providers/types.js';

type Member = Awaited<ReturnType<typeof identity.createUser>>;

export interface SeededMember {
  user: Member;
  jwt: string;
}

async function jwtFor(user: Member): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign({ sub: user.id, role: user.role, iat: now, exp: now + 3600 }, config.jwtSecret);
}

/** Seed the household + an admin, plus one adult and one child member, with JWTs. */
export async function seedTestHousehold(): Promise<{
  admin: SeededMember;
  adult: SeededMember;
  child: SeededMember;
}> {
  await householdCore.seedHousehold({ name: 'Test Household' });
  const admin = await identity.createUser({
    email: 'admin@test.local', handle: 'admin', password: 'test-admin-password',
    role: 'admin', displayName: 'Admin', avatarColor: 'ember',
  });
  const adult = await identity.createUser({
    email: 'adult@test.local', handle: 'adult', password: 'pw-adult-1',
    role: 'adult', displayName: 'Adult', avatarColor: 'sage',
  });
  const child = await identity.createUser({
    email: 'child@test.local', handle: 'child', password: 'pw-child-1',
    role: 'child', displayName: 'Child', avatarColor: 'sky',
  });
  return {
    admin: { user: admin, jwt: await jwtFor(admin) },
    adult: { user: adult, jwt: await jwtFor(adult) },
    child: { user: child, jwt: await jwtFor(child) },
  };
}

export function authHeaders(jwt: string): Record<string, string> {
  return { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' };
}

/**
 * Register a fake/stub {@link TaskProvider} into the integrations registry
 * under `id`, filling in the non-task fields of `RegisteredProvider` with
 * inert stubs. Task 11 moved the tasks module's write paths off the single
 * global `setTaskProvider` slot onto this registry, so tests that used to
 * install a fake provider that way now install it here instead — same fake
 * provider object, different seam.
 */
export function registerFakeTaskProvider(id: string, tasks: TaskProvider): void {
  registerProvider({
    id,
    store: new IntegrationStore(id),
    classifyError: () => 'error',
    fullResyncIntervalMs: 1000,
    authorizeUrl: () => `https://${id}.test`,
    completeConnect: async () => ({ accountLabel: `a@${id}`, refreshToken: 'r', scopes: '' }),
    calendar: null,
    tasks,
    runCalendarSync: async () => [],
    runTaskSync: async () => [],
  });
}

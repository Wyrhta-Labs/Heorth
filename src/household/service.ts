import { eq } from 'drizzle-orm';
import { household } from '@wyrhta/core/household';
import type { Role } from '@wyrhta/core/identity';
import { logError } from '@wyrhta/core/lib';
import { db } from '../db/index.js';
import { config } from '../config/env.js';
import { identity, householdCore } from '../wiring.js';
import { getFeohRuntime } from '../satellites/feoh/runtime.js';
import { MAINTENANCE_ADMIN_HANDLE, MaintenanceAdminError } from './maintenance-admin.js';
import type { CreateMemberInput, UpdateMemberInput, UpdateHouseholdInput } from './validators.js';

export function getHousehold() {
  return householdCore.getHousehold();
}

export async function updateHousehold(input: UpdateHouseholdInput) {
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch['name'] = input.name;
  if (input.timezone !== undefined) patch['timezone'] = input.timezone;
  if (input.locale !== undefined) patch['locale'] = input.locale;
  if (Object.keys(patch).length === 0) return householdCore.getHousehold();
  const [row] = await db.update(household).set(patch).returning();
  return row ?? null;
}

export function listMembers() {
  return householdCore.listMembers();
}

export function getMember(id: string) {
  return identity.getUser(id);
}

export async function createMember(input: CreateMemberInput) {
  // The UNIQUE constraint already makes the handle unclaimable once seeded; this
  // closes the pre-seed window and returns a clear 403 instead of a conflict.
  if (input.handle === MAINTENANCE_ADMIN_HANDLE) {
    throw new MaintenanceAdminError('ADMIN_PROTECTED', 'That handle is reserved');
  }
  try {
    return await identity.createUser({
      email: input.email,
      password: input.password,
      role: input.role,
      displayName: input.displayName,
      avatarColor: input.avatarColor,
      // Core requires a handle; derive one from the email local-part when absent.
      handle: input.handle ?? input.email.split('@')[0]!,
    });
  } catch (e: unknown) {
    // Core maps a unique violation to Error('CONFLICT'); a raw pg error may also surface.
    if (identity.isUniqueViolation(e) || (e instanceof Error && e.message === 'CONFLICT')) {
      throw new Error('EMAIL_TAKEN');
    }
    throw e;
  }
}

// The single choke-point where a member's profile (incl. displayName) is
// edited (see modules/feoh's `README`/proxy docs — this is finding G's
// resolution: everywhere else, Feoh's roster mirror only refreshes at
// startup or lazily on a mapping miss, so a renamed member would otherwise
// show stale in Feoh until one of those fires).
export async function updateMember(id: string, input: UpdateMemberInput) {
  const member = await identity.updateUser(id, input);
  if (member && input.displayName !== undefined) {
    // Best-effort, fire-and-forget: a re-upsert failure (e.g. Feoh down)
    // must never fail the profile update itself — the lazy re-sync on the
    // next finance request will still self-heal the mapping.
    void getFeohRuntime()
      .roster.upsertMember(member)
      .catch((e: unknown) => {
        logError(`feoh roster: best-effort re-upsert after displayName change failed (memberId=${id})`, e);
      });
  }
  return member;
}

export function setMemberRole(id: string, role: Role) {
  return householdCore.setRole(id, role);
}

export async function deleteMember(id: string, actingUserId: string) {
  if (id === actingUserId) throw new Error('CANNOT_DELETE_SELF');
  const members = await householdCore.listMembers();
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
  const { token, expiresIn } = await identity.issueToken(user);
  return { token, user, expiresIn };
}

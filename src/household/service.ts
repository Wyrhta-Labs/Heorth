import { eq } from 'drizzle-orm';
import { household } from '@wyrhta/core/household';
import type { Role } from '@wyrhta/core/identity';
import { db } from '../db/index.js';
import { identity, householdCore } from '../wiring.js';
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

export async function updateMember(id: string, input: UpdateMemberInput) {
  return identity.updateUser(id, input);
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

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

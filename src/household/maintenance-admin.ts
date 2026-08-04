import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import { createUser, hashPassword, users, verifyPassword } from '@wyrhta/core/identity';
import { logEvent } from '@wyrhta/core/lib';
import { db } from '../db/index.js';
import { events, eventAttendees } from '../modules/calendar/schema.js';
import { calendarMirrorEvents } from '../modules/calendar/mirror-schema.js';
import { recipes, mealPlanEntries } from '../modules/meals/schema.js';
import { libraryConnections } from '../modules/library/schema.js';
import { m365Connections } from '../m365/schema.js';
import { taskMirror, todoListAllowlist } from '../modules/tasks/schema.js';

/** The transaction handle `db.transaction()` hands its callback. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * The maintenance admin is anchored on its HANDLE, not its email.
 *
 * `users.handle` is UNIQUE (migration 0000) and `repairMaintenanceAdmin()` hardcodes it, so the
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
  return db.transaction(async (tx) => {
    const [anchored] = await tx.select().from(users)
      .where(eq(users.handle, MAINTENANCE_ADMIN_HANDLE)).limit(1);

    let adminId: string;
    if (!anchored) {
      // No anchored admin. Refuse to seed if the configured email already belongs
      // to somebody else — that is an operator error, not something to paper over.
      const [emailOwner] = await tx.select().from(users)
        .where(eq(users.email, input.adminEmail)).limit(1);
      if (emailOwner) {
        throw new Error(
          `ADMIN_EMAIL is already held by member ${emailOwner.id} (handle '${emailOwner.handle}'). ` +
            'Change ADMIN_EMAIL or rename that member before starting.',
        );
      }
      const created = await createUser(tx, {
        email: input.adminEmail, handle: MAINTENANCE_ADMIN_HANDLE,
        password: input.adminPassword, role: 'admin', displayName: 'Admin',
      });
      adminId = created.id;
    } else {
      adminId = anchored.id;
      // Re-sync env onto the anchored row: env is the source of truth, so an
      // ADMIN_EMAIL rotation is an in-place update, never a second account.
      const patch: Partial<typeof users.$inferInsert> = {};
      if (anchored.email !== input.adminEmail) {
        const [emailOwner] = await tx.select().from(users)
          .where(and(eq(users.email, input.adminEmail), ne(users.id, adminId))).limit(1);
        if (emailOwner) {
          throw new Error(
            `ADMIN_EMAIL is already held by member ${emailOwner.id} (handle '${emailOwner.handle}').`,
          );
        }
        patch.email = input.adminEmail;
      }
      if (anchored.role !== 'admin') patch.role = 'admin';
      // NOTE the argument order: core's signature is verifyPassword(hash, plain).
      if (!(await verifyPassword(anchored.passwordHash, input.adminPassword))) {
        patch.passwordHash = await hashPassword(input.adminPassword);
      }
      const changedFields = Object.keys(patch);
      if (changedFields.length > 0) {
        patch.updatedAt = new Date();
        await tx.update(users).set(patch).where(eq(users.id, adminId));
        // Field NAMES only — never log the password, the hash, or any token material.
        logEvent({ event: 'maintenance_admin.repair.resynced', member_id: adminId, fields: changedFields });
      }
    }

    await stripAdminOwnedData(tx, adminId);
    return { adminId };
  });
}

/**
 * Remove every trace of the admin from household content. Mirror rows are derived
 * data — a re-sync rebuilds them — so they are deleted rather than repointed.
 */
async function stripAdminOwnedData(tx: Tx, adminId: string): Promise<void> {
  const counts: Record<string, number> = {};

  const attendees = await tx.delete(eventAttendees).where(eq(eventAttendees.memberId, adminId));
  counts['event_attendees'] = attendees.count;
  const m365 = await tx.delete(m365Connections).where(eq(m365Connections.memberId, adminId));
  counts['m365_connections'] = m365.count;
  const library = await tx.delete(libraryConnections).where(eq(libraryConnections.memberId, adminId));
  counts['library_connections'] = library.count;
  const allowlist = await tx.delete(todoListAllowlist).where(eq(todoListAllowlist.memberId, adminId));
  counts['todo_list_allowlist'] = allowlist.count;
  const tasks = await tx.delete(taskMirror).where(eq(taskMirror.memberId, adminId));
  counts['task_mirror'] = tasks.count;
  const mirrorEvents = await tx.delete(calendarMirrorEvents).where(eq(calendarMirrorEvents.memberId, adminId));
  counts['calendar_mirror_events'] = mirrorEvents.count;

  // `cook`/`helper` are nullable with ON DELETE set null — clearing is the
  // schema's own notion of "unassigned", so no repointing is needed.
  const cooks = await tx.update(mealPlanEntries).set({ cook: null }).where(eq(mealPlanEntries.cook, adminId));
  counts['meal_plan_entries.cook'] = cooks.count;
  const helpers = await tx.update(mealPlanEntries).set({ helper: null }).where(eq(mealPlanEntries.helper, adminId));
  counts['meal_plan_entries.helper'] = helpers.count;

  // `created_by` is NOT NULL, so it must be repointed. With no non-admin member
  // there is nothing to point at; leave it and repair on a later boot.
  const [heir] = await tx.select({ id: users.id }).from(users)
    .where(ne(users.handle, MAINTENANCE_ADMIN_HANDLE))
    .orderBy(asc(users.createdAt)).limit(1);
  if (heir) {
    const eventsRepointed = await tx.update(events).set({ createdBy: heir.id }).where(eq(events.createdBy, adminId));
    counts['events.created_by'] = eventsRepointed.count;
    const recipesRepointed = await tx.update(recipes).set({ createdBy: heir.id }).where(eq(recipes.createdBy, adminId));
    counts['recipes.created_by'] = recipesRepointed.count;
  }

  const totalAffected = Object.values(counts).reduce((sum, n) => sum + n, 0);
  if (totalAffected > 0) {
    logEvent({ event: 'maintenance_admin.repair.stripped', member_id: adminId, ...counts });
  }
}

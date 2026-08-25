import { and, asc, count, desc, eq, isNotNull, isNull, lte, notInArray, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  weorcOccurrences,
  weorcRoutines,
  type NewWeorcRoutine,
  type OccurrenceStatus,
  type WeorcOccurrence,
  type WeorcRoutine,
} from './schema.js';

export interface ListRoutinesQuery {
  active?: boolean;
  anchorAssetId?: string;
  anchorPlaceId?: string;
  ownerMemberId?: string;
  limit?: number;
  offset?: number;
}

export async function listRoutines(q: ListRoutinesQuery = {}): Promise<{
  rows: WeorcRoutine[];
  total: number;
  limit: number;
  offset: number;
}> {
  const conditions = [];
  if (q.active !== undefined) conditions.push(eq(weorcRoutines.active, q.active));
  if (q.anchorAssetId) conditions.push(eq(weorcRoutines.anchorAssetId, q.anchorAssetId));
  if (q.anchorPlaceId) conditions.push(eq(weorcRoutines.anchorPlaceId, q.anchorPlaceId));
  if (q.ownerMemberId) conditions.push(eq(weorcRoutines.ownerMemberId, q.ownerMemberId));
  const where = conditions.length ? and(...conditions) : undefined;
  const limit = q.limit ?? 50;
  const offset = q.offset ?? 0;

  const rows = await db.select().from(weorcRoutines).where(where)
    .orderBy(asc(weorcRoutines.name)).limit(limit).offset(offset);
  const [{ count: total }] = await db.select({ count: sql<number>`count(*)::int` }).from(weorcRoutines).where(where);
  return { rows, total: total ?? 0, limit, offset };
}

export async function getRoutine(id: string): Promise<WeorcRoutine | null> {
  const [row] = await db.select().from(weorcRoutines).where(eq(weorcRoutines.id, id));
  return row ?? null;
}

export async function createRoutine(input: NewWeorcRoutine): Promise<WeorcRoutine> {
  const [row] = await db.insert(weorcRoutines).values(input).returning();
  return row!;
}

export async function updateRoutine(
  id: string,
  patch: Partial<NewWeorcRoutine>,
): Promise<WeorcRoutine | null> {
  const [row] = await db.update(weorcRoutines)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(weorcRoutines.id, id))
    .returning();
  return row ?? null;
}

export async function deleteRoutine(id: string): Promise<boolean> {
  const rows = await db.delete(weorcRoutines).where(eq(weorcRoutines.id, id)).returning();
  return rows.length > 0;
}

export async function hasTerminalOccurrence(routineId: string): Promise<boolean> {
  const [row] = await db.select({ count: count() }).from(weorcOccurrences)
    .where(and(eq(weorcOccurrences.routineId, routineId), sql`${weorcOccurrences.status} <> 'due'`));
  return Number(row?.count ?? 0) > 0;
}

export async function getOpenOccurrence(routineId: string): Promise<WeorcOccurrence | null> {
  const [row] = await db.select().from(weorcOccurrences)
    .where(and(eq(weorcOccurrences.routineId, routineId), eq(weorcOccurrences.status, 'due')));
  return row ?? null;
}

export async function lastTerminalOccurrence(routineId: string): Promise<WeorcOccurrence | null> {
  const [row] = await db.select().from(weorcOccurrences)
    .where(and(eq(weorcOccurrences.routineId, routineId), sql`${weorcOccurrences.status} <> 'due'`))
    .orderBy(desc(weorcOccurrences.dueOn))
    .limit(1);
  return row ?? null;
}

let insertOccurrenceConflictHookForTest: (() => Promise<void> | void) | null = null;

export function setInsertOccurrenceConflictHookForTest(hook: (() => Promise<void> | void) | null): void {
  insertOccurrenceConflictHookForTest = hook;
}

/**
 * Materialise one occurrence. `ON CONFLICT DO NOTHING` because the scheduler
 * tick and a REST completion can race: the unique constraints stop a duplicate
 * row, but a bare insert would still turn the loser into a 500. On conflict we
 * re-read whatever occurrence is currently open for the routine and return that.
 * If the blocking open row was terminalized between the conflict and the read,
 * retrying lets the same due date insert once the partial index is free.
 */
export async function insertOccurrence(routineId: string, dueOn: string): Promise<WeorcOccurrence> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const [row] = await db.insert(weorcOccurrences)
      .values({ routineId, dueOn })
      .onConflictDoNothing()
      .returning();
    if (row) return row;

    await insertOccurrenceConflictHookForTest?.();

    const open = await getOpenOccurrence(routineId);
    if (open) return open;

    // The conflict may have been on (routineId, dueOn) against a terminal row.
    const [existing] = await db.select().from(weorcOccurrences)
      .where(and(eq(weorcOccurrences.routineId, routineId), eq(weorcOccurrences.dueOn, dueOn)));
    if (existing) return existing;
  }

  throw new Error(`Failed to materialise Weorc occurrence for routine ${routineId} due on ${dueOn}`);
}

export async function getOccurrence(id: string): Promise<WeorcOccurrence | null> {
  const [row] = await db.select().from(weorcOccurrences).where(eq(weorcOccurrences.id, id));
  return row ?? null;
}

export interface ListOccurrencesQuery {
  status?: OccurrenceStatus;
  routineId?: string;
  dueTo?: string;
  limit?: number;
}

export async function listOccurrences(q: ListOccurrencesQuery = {}): Promise<WeorcOccurrence[]> {
  const conditions = [];
  if (q.status) conditions.push(eq(weorcOccurrences.status, q.status));
  if (q.routineId) conditions.push(eq(weorcOccurrences.routineId, q.routineId));
  if (q.dueTo) conditions.push(lte(weorcOccurrences.dueOn, q.dueTo));

  return db.select().from(weorcOccurrences)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(weorcOccurrences.dueOn))
    .limit(q.limit ?? 200);
}

export async function terminateOccurrence(
  id: string,
  status: 'completed' | 'skipped',
  completedAt: Date | null,
  memberId: string | null,
  note: string | null,
): Promise<WeorcOccurrence | null> {
  const [row] = await db.update(weorcOccurrences)
    .set({
      status,
      completedAt: status === 'completed' ? (completedAt ?? new Date()) : null,
      completedByMemberId: memberId,
      note,
      updatedAt: new Date(),
    })
    .where(eq(weorcOccurrences.id, id))
    .returning();
  return row ?? null;
}

export async function setProjection(id: string, feedKey: string, externalId: string): Promise<void> {
  await db.update(weorcOccurrences)
    .set({
      taskFeedKey: feedKey,
      taskExternalId: externalId,
      projectionError: null,
      updatedAt: new Date(),
    })
    .where(eq(weorcOccurrences.id, id));
}

export async function setProjectionError(id: string, reason: string | null): Promise<void> {
  await db.update(weorcOccurrences)
    .set({ projectionError: reason, updatedAt: new Date() })
    .where(eq(weorcOccurrences.id, id));
}

/** Active routines with nothing currently open - the materialise pass's input. */
export async function activeRoutinesWithoutOpenOccurrence(): Promise<WeorcRoutine[]> {
  const open = db.select({ id: weorcOccurrences.routineId }).from(weorcOccurrences)
    .where(eq(weorcOccurrences.status, 'due'));
  return db.select().from(weorcRoutines)
    .where(and(eq(weorcRoutines.active, true), notInArray(weorcRoutines.id, open)))
    .orderBy(asc(weorcRoutines.name));
}

/** Open occurrences that are projected - the reconcile pass's input. */
export async function openOccurrencesWithLink(): Promise<WeorcOccurrence[]> {
  return db.select().from(weorcOccurrences)
    .where(and(eq(weorcOccurrences.status, 'due'), isNotNull(weorcOccurrences.taskExternalId)));
}

/** Open occurrences that are not projected - the project pass's input. */
export async function openOccurrencesWithoutLink(): Promise<WeorcOccurrence[]> {
  return db.select().from(weorcOccurrences)
    .where(and(eq(weorcOccurrences.status, 'due'), isNull(weorcOccurrences.taskExternalId)));
}

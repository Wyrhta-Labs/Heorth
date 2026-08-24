import { db } from '../../db/index.js';
import { pgErrorCode } from '@wyrhta/core/db';
import { ethelPlaces, type EthelPlace } from './schema.js';
import { eq, sql, asc } from 'drizzle-orm';
import type { CreatePlaceInput, UpdatePlaceInput } from './validators.js';

/** Bounds the recursive queries and keeps the UI picker usable. Raising it is
 *  a validator + UI change, not a migration (spec, Part B open risks). */
export const MAX_PLACE_DEPTH = 6;

/** Hard stop inside every recursive walk below. `assertPlaceable` keeps the
 *  tree acyclic, so this should never bind - but a cycle that DID exist would
 *  make a `UNION ALL` walk recurse until the statement is killed, so one bad
 *  row would hang every request that filtered by that subtree. The guard costs
 *  one comparison and removes that failure mode outright. */
const WALK_LIMIT = 64;

/** Anything that can run a query: the pool, or a transaction. Structural, so a
 *  drizzle transaction satisfies it without naming its generic-heavy type. */
type Executor = Pick<typeof db, 'select' | 'insert' | 'update' | 'delete' | 'execute'>;

/** Serialises mutations of the place tree.
 *
 *  ================== THE PLACE-TREE LOCK PROTOCOL, IN ONE RULE ==================
 *
 *    A transaction that writes ethel_places, OR that writes a column
 *    referencing ethel_places, takes THIS LOCK FIRST - before touching any
 *    row. Everything else takes nothing.
 *
 *  That is the whole protocol. It is stated as a rule about REFERENCES rather
 *  than as a list of functions, because the list kept growing: the deadlock was
 *  first found between deletePlace and upsertFacility, then found again through
 *  updateAsset, and a list would have to be re-derived every time a table gains
 *  an FK to ethel_places. The rule covers those cases and the next one.
 *
 *  Who that makes participants, today:
 *
 *      createPlace / updatePlace / deletePlace   (write ethel_places)
 *      createAsset / updateAsset                 (write ethel_assets.place_id,
 *                                                 Task 4 - but only when the
 *                                                 write actually sets a place)
 *      upsertFacility                            (writes ethel_facility_places)
 *
 *  And who it does not - not as exceptions, but because they reference no
 *  place at all:
 *
 *      upsertVehicle, deleteVehicle, deleteFacility, decommissionAsset,
 *      deleteAsset, and every read
 *
 *  WHY a lock is needed at all, and it is two separate reasons:
 *
 *  1. The cycle and depth checks READ the tree and then WRITE it. Two
 *     concurrent reparents each pass their check against a tree the other is
 *     about to change, and together make a cycle neither could make alone.
 *  2. Deadlock. Writers approach the same two tables from opposite ends -
 *
 *         deletePlace(P):    DELETE P -> (ON DELETE SET NULL) needs a row lock
 *                            on every asset placed in P
 *         updateAsset(A):    row lock on A -> setting place_id takes an FK
 *                            share lock on place P
 *
 *     - so interleaved, that is P held while waiting for A against A held while
 *     waiting for P. Postgres detects it, aborts one with 40P01, and a member
 *     gets a 500 for deleting a room. Neither statement mentions the other's
 *     table, which is why this is invisible from inside either function and has
 *     to be a rule at the module level.
 *
 *  A single advisory lock is the right size of fix: the tree is tens of rows,
 *  every participant is a rare write (a household reorganising rooms or filing
 *  an appliance), and the lock releases on commit OR rollback with no cleanup
 *  path to get wrong. The key is arbitrary; it only has to be unique in this
 *  database.
 *
 *  NOT unit-testable, and pretending otherwise wastes a test. Proving a
 *  deadlock is gone needs two transactions interleaved at an exact point, which
 *  Vitest against a shared truncating database cannot do reliably. The protocol
 *  is enforced by this comment and by review; the failure mode if it is ever
 *  broken is loud and specific: SQLSTATE 40P01 on a place delete. What to
 *  verify instead, by inspection, whenever a new table gains an FK to
 *  ethel_places: does the transaction that writes it take this lock first?
 *  ============================================================================ */
const PLACE_TREE_LOCK_KEY = 4711013;

export async function lockPlaceTree(tx: Executor): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${PLACE_TREE_LOCK_KEY})`);
}

export async function listPlaces(): Promise<EthelPlace[]> {
  // Deliberately unpaginated: the client needs the whole set to assemble a
  // tree, and a household has tens of places, not thousands.
  return db.select().from(ethelPlaces).orderBy(asc(ethelPlaces.name));
}

/** Ids from `id` up to its root, `id` itself included. */
async function ancestorIds(tx: Executor, id: string): Promise<string[]> {
  const rows = await tx.execute(sql`
    WITH RECURSIVE up AS (
      SELECT id, parent_id, 1 AS depth FROM ethel_places WHERE id = ${id}::uuid
      UNION ALL
      SELECT p.id, p.parent_id, up.depth + 1
        FROM ethel_places p JOIN up ON p.id = up.parent_id
       WHERE up.depth < ${WALK_LIMIT}
    )
    SELECT id FROM up`) as unknown as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

/** 1 for a leaf, 2 if it has children, ... - the moved subtree's own height. */
async function heightOf(tx: Executor, id: string): Promise<number> {
  const rows = await tx.execute(sql`
    WITH RECURSIVE down AS (
      SELECT id, 1 AS h FROM ethel_places WHERE id = ${id}::uuid
      UNION ALL
      SELECT p.id, down.h + 1
        FROM ethel_places p JOIN down ON p.parent_id = down.id
       WHERE down.h < ${WALK_LIMIT}
    )
    SELECT COALESCE(max(h), 0)::int AS height FROM down`) as unknown as Array<{ height: number }>;
  return rows[0]?.height ?? 0;
}

/** Every id in the subtree rooted at `id`, including `id`. Bounded by the depth
 *  cap in practice and by WALK_LIMIT absolutely. Returned as ids so callers
 *  stay drizzle-typed via inArray. Read-only, so it takes no lock. */
export async function descendantPlaceIds(id: string): Promise<string[]> {
  const rows = await db.execute(sql`
    WITH RECURSIVE sub AS (
      SELECT id, 1 AS depth FROM ethel_places WHERE id = ${id}::uuid
      UNION ALL
      SELECT p.id, sub.depth + 1
        FROM ethel_places p JOIN sub ON p.parent_id = sub.id
       WHERE sub.depth < ${WALK_LIMIT}
    )
    SELECT id FROM sub`) as unknown as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

/** The invariants Postgres cannot express. `movedId` is undefined on create
 *  (nothing is being moved, so the subtree height is 1). Must be called inside
 *  the same transaction as the write, after lockPlaceTree. */
async function assertPlaceable(tx: Executor, parentId: string | null, movedId?: string): Promise<void> {
  if (parentId === null) return;
  if (movedId && parentId === movedId) throw new Error('PLACE_CYCLE');

  // Checked FIRST, and this order is load-bearing: an unknown parent otherwise
  // walks zero ancestors, computes a depth of 0, passes every check below, and
  // then surfaces as a raw 500 from the foreign-key violation on write.
  const [parent] = await tx.select({ id: ethelPlaces.id }).from(ethelPlaces)
    .where(eq(ethelPlaces.id, parentId)).limit(1);
  if (!parent) throw new Error('PLACE_NOT_FOUND');

  const ancestors = await ancestorIds(tx, parentId);
  if (movedId && ancestors.includes(movedId)) throw new Error('PLACE_CYCLE');
  const height = movedId ? await heightOf(tx, movedId) : 1;
  if (ancestors.length + height > MAX_PLACE_DEPTH) throw new Error('PLACE_TOO_DEEP');
}

/** Classified through pgErrorCode, NEVER by reading e.code - a
 *  DrizzleQueryError's own code is undefined, so `e.code === '23505'` reads
 *  undefined, falls through, and turns a mapped 409 into a raw 500. */
function asWriteError(e: unknown): never {
  if (pgErrorCode(e) === '23505') throw new Error('PLACE_NAME_TAKEN');
  // Unreachable by design - assertPlaceable pre-checks the parent inside the
  // same locked transaction - but a 400 beats a 500 if that ever stops holding.
  if (pgErrorCode(e) === '23503') throw new Error('PLACE_NOT_FOUND');
  throw e;
}

export async function createPlace(i: CreatePlaceInput): Promise<EthelPlace> {
  return db.transaction(async (tx) => {
    await lockPlaceTree(tx);
    await assertPlaceable(tx, i.parentId ?? null);
    try {
      const [row] = await tx.insert(ethelPlaces).values({
        name: i.name, kind: i.kind, parentId: i.parentId ?? null, notes: i.notes ?? null,
      }).returning();
      return row!;
    } catch (e: unknown) { asWriteError(e); }
  });
}

export async function updatePlace(id: string, i: UpdatePlaceInput): Promise<EthelPlace | null> {
  return db.transaction(async (tx) => {
    await lockPlaceTree(tx);
    if ('parentId' in i) await assertPlaceable(tx, i.parentId ?? null, id);
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const k of ['name', 'kind', 'parentId', 'notes'] as const) {
      if (i[k] !== undefined) patch[k] = i[k];
    }
    try {
      const [row] = await tx.update(ethelPlaces).set(patch).where(eq(ethelPlaces.id, id)).returning();
      return row ?? null;
    } catch (e: unknown) { asWriteError(e); }
  });
}

export async function deletePlace(id: string): Promise<EthelPlace | null> {
  return db.transaction(async (tx) => {
    await lockPlaceTree(tx);
    const [child] = await tx.select({ id: ethelPlaces.id }).from(ethelPlaces)
      .where(eq(ethelPlaces.parentId, id)).limit(1);
    // Child places block the delete; ASSETS in the place do not - they are
    // unassigned by ON DELETE SET NULL (Task 4), deliberately unlike the
    // module's other destructive paths, which refuse (ADR 0013).
    if (child) throw new Error('PLACE_HAS_CHILDREN');
    try {
      const [row] = await tx.delete(ethelPlaces).where(eq(ethelPlaces.id, id)).returning();
      return row ?? null;
    } catch (e: unknown) {
      // ON DELETE RESTRICT is the actual enforcement; the check above is the
      // fast path. A 23503 here means a child exists, which is the same answer.
      if (pgErrorCode(e) === '23503') throw new Error('PLACE_HAS_CHILDREN');
      throw e;
    }
  });
}

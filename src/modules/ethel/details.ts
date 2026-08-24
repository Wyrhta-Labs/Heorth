import { db } from '../../db/index.js';
import { pgErrorCode } from '@wyrhta/core/db';
import { ethelVehicles, ethelFacilities, ethelFacilityPlaces, type EthelVehicle, type EthelFacility } from './schema.js';
import { eq, sql } from 'drizzle-orm';
import { lockPlaceTree } from './places.js';
import type { VehicleInput, FacilityInput } from './validators.js';

/** Anything that can run a query: the pool, or a transaction. Same structural
 *  alias as places.ts - keep the two in step if either changes. */
type Executor = Pick<typeof db, 'select' | 'insert' | 'update' | 'delete' | 'execute'>;

/** Locks the asset row and proves it exists, in one statement.
 *
 *  Both detail upserts run entirely inside the transaction that takes this
 *  lock, which is what makes the at-most-one-detail rule (Task 6) hold: a
 *  concurrent PUT to the OTHER detail table blocks here until this one commits,
 *  instead of passing its own check against a table this one is about to write.
 *  Locking the ASSET rather than either detail row is the point - it is the row
 *  both writers have in common, and the only one that exists before either
 *  detail does. */
async function lockAsset(tx: Executor, assetId: string): Promise<boolean> {
  const rows = await tx.execute(
    sql`SELECT id FROM ethel_assets WHERE id = ${assetId}::uuid FOR UPDATE`,
  ) as unknown as unknown[];
  return rows.length > 0;
}
// LOCK PROTOCOL: see the block comment on lockPlaceTree in places.ts. A
// transaction that writes a column referencing ethel_places takes that lock
// FIRST, before this one. upsertFacility (Task 6) writes
// ethel_facility_places, so it does. upsertVehicle below references no place,
// so it takes nothing - that is the rule applying, not an exception to it.

/** Part B makes "the detail row exists" the only signal of what kind of thing
 *  an asset is - `category` is free text and always was. An asset that were
 *  both a vehicle and a facility would destroy that signal, so the upsert
 *  refuses. The web hides the other action once one exists, which is this
 *  rule expressed as UI rather than as an error the member has to read.
 *
 *  It takes `tx`, NOT `db`, and that is the whole safety argument. Read
 *  outside the transaction that holds lockAsset's row lock, this is a check
 *  with a gap after it: a concurrent PUT /vehicle and PUT /facility would both
 *  find the other table empty, both pass, and both commit, leaving an asset
 *  with two detail rows and no constraint to notice. Inside the locked
 *  transaction the second writer blocks until the first commits and then sees
 *  its row. Call it immediately after lockAsset and before any write. */
async function assertNoOtherDetail(tx: Executor, assetId: string, self: 'vehicle' | 'facility'): Promise<void> {
  const other = self === 'vehicle'
    ? await tx.select({ id: ethelFacilities.assetId }).from(ethelFacilities).where(eq(ethelFacilities.assetId, assetId)).limit(1)
    : await tx.select({ id: ethelVehicles.assetId }).from(ethelVehicles).where(eq(ethelVehicles.assetId, assetId)).limit(1);
  if (other.length > 0) throw new Error('ASSET_DETAIL_CONFLICT');
}

export async function getVehicle(assetId: string): Promise<EthelVehicle | null> {
  const [row] = await db.select().from(ethelVehicles).where(eq(ethelVehicles.assetId, assetId)).limit(1);
  return row ?? null;
}

/** Distinguishes the two vehicle uniques by index name. pgErrorCode walks the
 *  DrizzleQueryError cause chain; reading e.code directly reads undefined. */
function asVehicleConflict(e: unknown): never {
  if (pgErrorCode(e) === '23505') {
    const text = e instanceof Error ? `${e.message} ${String((e as { cause?: unknown }).cause ?? '')}` : '';
    if (text.includes('ethel_vehicles_vin_unique')) throw new Error('VEHICLE_VIN_TAKEN');
    throw new Error('VEHICLE_REGISTRATION_TAKEN');
  }
  throw e;
}

export async function upsertVehicle(
  assetId: string, i: VehicleInput,
): Promise<{ row: EthelVehicle; created: boolean } | null> {
  return db.transaction(async (tx) => {
    if (!(await lockAsset(tx, assetId))) return null;
    await assertNoOtherDetail(tx, assetId, 'vehicle');
    const [existing] = await tx.select({ id: ethelVehicles.assetId }).from(ethelVehicles)
      .where(eq(ethelVehicles.assetId, assetId)).limit(1);
    const values = {
      registration: i.registration ?? null,
      vin: i.vin ?? null,
      firstRegisteredOn: i.firstRegisteredOn ?? null,
      odometer: i.odometer ?? null,
      odometerReadAt: i.odometerReadAt ?? null,
      serviceIntervalMonths: i.serviceIntervalMonths ?? null,
    };
    try {
      if (existing) {
        const [row] = await tx.update(ethelVehicles).set({ ...values, updatedAt: new Date() })
          .where(eq(ethelVehicles.assetId, assetId)).returning();
        return { row: row!, created: false };
      }
      const [row] = await tx.insert(ethelVehicles).values({ assetId, ...values }).returning();
      return { row: row!, created: true };
    } catch (e: unknown) { asVehicleConflict(e); }
  });
}

export async function deleteVehicle(assetId: string): Promise<boolean> {
  const rows = await db.delete(ethelVehicles).where(eq(ethelVehicles.assetId, assetId)).returning();
  return rows.length > 0;
}

export async function getFacility(assetId: string): Promise<(EthelFacility & { servesPlaceIds: string[] }) | null> {
  const [row] = await db.select().from(ethelFacilities).where(eq(ethelFacilities.assetId, assetId)).limit(1);
  if (!row) return null;
  const links = await db.select({ placeId: ethelFacilityPlaces.placeId }).from(ethelFacilityPlaces)
    .where(eq(ethelFacilityPlaces.facilityId, assetId));
  return { ...row, servesPlaceIds: links.map((l) => l.placeId) };
}

export async function upsertFacility(
  assetId: string, i: FacilityInput,
): Promise<{ row: EthelFacility & { servesPlaceIds: string[] }; created: boolean } | null> {
  // ONE transaction for the lock, the conflict check, the detail row and its
  // links. Three reasons, all load-bearing: the lock must outlive the check
  // (see above); the detail row and its served set are one fact, so a
  // half-written set would be worse than a rejected call; and the links are
  // deleted before being re-inserted, which is not a state any reader should
  // ever observe.
  const created = await db.transaction(async (tx) => {
    // FIRST, before the asset row lock: this transaction is about to insert
    // ethel_facility_places rows, which take FK share locks on places, and
    // deletePlace holds this lock while its ON DELETE SET NULL reaches for
    // asset rows. Same order in both paths, no cycle. See the lock-order
    // comment on lockPlaceTree in places.ts.
    await lockPlaceTree(tx);
    if (!(await lockAsset(tx, assetId))) return null;
    await assertNoOtherDetail(tx, assetId, 'facility');
    const [existing] = await tx.select({ id: ethelFacilities.assetId }).from(ethelFacilities)
      .where(eq(ethelFacilities.assetId, assetId)).limit(1);
    const isNew = !existing;
    const values = {
      kind: i.kind,
      commissionedOn: i.commissionedOn ?? null,
      serviceIntervalMonths: i.serviceIntervalMonths ?? null,
    };
    const serves = i.servesPlaceIds ?? [];
    try {
      if (isNew) await tx.insert(ethelFacilities).values({ assetId, ...values });
      else await tx.update(ethelFacilities).set({ ...values, updatedAt: new Date() }).where(eq(ethelFacilities.assetId, assetId));
      await tx.delete(ethelFacilityPlaces).where(eq(ethelFacilityPlaces.facilityId, assetId));
      if (serves.length) {
        await tx.insert(ethelFacilityPlaces).values(serves.map((placeId) => ({ facilityId: assetId, placeId })));
      }
    } catch (e: unknown) {
      // 23503 = foreign_key_violation: a servesPlaceIds entry names a place
      // that does not exist. Classified via pgErrorCode, never by reading
      // e.code. 23505 cannot reach here - the validator dedupes the set.
      if (pgErrorCode(e) === '23503') throw new Error('PLACE_NOT_FOUND');
      throw e;
    }
    return isNew;
  });
  if (created === null) return null;
  return { row: (await getFacility(assetId))!, created };
}

export async function deleteFacility(assetId: string): Promise<boolean> {
  // The links go by cascade, not by a second statement.
  const rows = await db.delete(ethelFacilities).where(eq(ethelFacilities.assetId, assetId)).returning();
  return rows.length > 0;
}

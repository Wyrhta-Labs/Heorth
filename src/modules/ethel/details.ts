import { db } from '../../db/index.js';
import { pgErrorCode } from '@wyrhta/core/db';
import { ethelVehicles, type EthelVehicle } from './schema.js';
import { eq, sql } from 'drizzle-orm';
import type { VehicleInput } from './validators.js';

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
    // Task 6 inserts assertNoOtherDetail(tx, assetId, 'vehicle') here.
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

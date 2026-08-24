import { db } from '../../db/index.js';
import { isPgError, pgErrorCode } from '@wyrhta/core/db';
import { ethelAssets, type EthelAsset, type EthelVehicle, type EthelFacility } from './schema.js';
import { eq, and, isNull, isNotNull, ilike, or, inArray, sql } from 'drizzle-orm';
import { descendantPlaceIds, lockPlaceTree } from './places.js';
import { getVehicle, getFacility } from './details.js';
import type { CreateAssetInput, UpdateAssetInput, DecommissionInput } from './validators.js';

export async function listAssets(q: {
  status?: 'active' | 'decommissioned'; category?: string; q?: string;
  placeId?: string; includeDescendants?: boolean; limit?: number; offset?: number;
}): Promise<{ rows: EthelAsset[]; total: number; limit: number; offset: number }> {
  const conditions = [];
  if (q.status === 'active') conditions.push(isNull(ethelAssets.decommissionedAt));
  if (q.status === 'decommissioned') conditions.push(isNotNull(ethelAssets.decommissionedAt));
  if (q.category) conditions.push(eq(ethelAssets.category, q.category));
  if (q.placeId) {
    const ids = q.includeDescendants ? await descendantPlaceIds(q.placeId) : [q.placeId];
    // Recursive CTE returns place ids; the row query stays drizzle-typed via
    // inArray. Bounded by the depth cap.
    conditions.push(inArray(ethelAssets.placeId, ids));
  }
  if (q.q) {
    // Escape LIKE/ILIKE wildcards in user input (Postgres' default ESCAPE
    // character is backslash) so a literal "%" or "_" in a search term
    // doesn't act as a wildcard, e.g. searching "100%" must not match "1000".
    const escaped = q.q.replace(/[\\%_]/g, (c) => `\\${c}`);
    const pat = `%${escaped}%`;
    conditions.push(or(
      ilike(ethelAssets.name, pat), ilike(ethelAssets.manufacturer, pat),
      ilike(ethelAssets.model, pat), ilike(ethelAssets.serialNumber, pat),
    )!);
  }
  const where = conditions.length ? and(...conditions) : undefined;
  const limit = Math.min(100, Math.max(1, q.limit ?? 50));
  const offset = Math.max(0, q.offset ?? 0);
  const rows = await db.select().from(ethelAssets).where(where)
    .orderBy(ethelAssets.name).limit(limit).offset(offset);
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(ethelAssets).where(where);
  return { rows, total: count!, limit, offset };
}

/** An unknown placeId is the caller's mistake. Unmapped it is a 500 - the same
 *  hole PLACE_NOT_FOUND closed on the place routes. */
function asAssetWriteError(e: unknown): never {
  if (pgErrorCode(e) === '23503') throw new Error('PLACE_NOT_FOUND');
  throw e;
}

/** Asset writes that name a place join the place-tree lock protocol - see the
 *  block comment in places.ts. A write that does NOT touch place_id takes no
 *  lock, because it references no place: renaming an asset stays lock-free. */
export async function createAsset(i: CreateAssetInput): Promise<EthelAsset> {
  return db.transaction(async (tx) => {
    if (i.placeId != null) await lockPlaceTree(tx);
    try {
      const [row] = await tx.insert(ethelAssets).values({
        name: i.name, category: i.category ?? null, manufacturer: i.manufacturer ?? null,
        model: i.model ?? null, serialNumber: i.serialNumber ?? null,
        placeId: i.placeId ?? null, locationNote: i.locationNote ?? null,
        notes: i.notes ?? null, warrantyUntil: i.warrantyUntil ?? null,
        purchasePrice: i.purchasePrice != null ? String(i.purchasePrice) : null,
        purchaseDate: i.purchaseDate ?? null,
      }).returning();
      return row!;
    } catch (e: unknown) { asAssetWriteError(e); }
  });
}

export async function getAsset(id: string): Promise<(EthelAsset & {
  vehicle: EthelVehicle | null;
  facility: (EthelFacility & { servesPlaceIds: string[] }) | null;
}) | null> {
  const [row] = await db.select().from(ethelAssets).where(eq(ethelAssets.id, id)).limit(1);
  if (!row) return null;
  // Inlined so the detail view is ONE request. The LIST does not inline it.
  return { ...row, vehicle: await getVehicle(id), facility: await getFacility(id) };
}

/** The one sanctioned ethel->feoh touchpoint: a table-level existence read
 *  (no module import). Covered by a test so a rename breaks loudly.
 *  NOTE: postgres-js raw results are an ARRAY (RowList), not `{ rows }`. */
async function hasDisposalLink(assetId: string): Promise<boolean> {
  const rows = await db.execute(sql`SELECT 1 FROM feoh_item_costs WHERE asset_id = ${assetId}::uuid AND kind = 'disposal' LIMIT 1`) as unknown as unknown[];
  return rows.length > 0;
}

/** Same protocol as createAsset: the lock is taken only when the patch
 *  actually sets a place, because a patch that leaves place_id alone
 *  references no place. */
export async function updateAsset(id: string, i: UpdateAssetInput): Promise<EthelAsset | null> {
  return db.transaction(async (tx) => {
    if (i.placeId != null) await lockPlaceTree(tx);
    const isReactivation = 'decommissionedAt' in i;
    if (isReactivation && await hasDisposalLink(id)) throw new Error('DISPOSAL_LINK_EXISTS');
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const k of ['name', 'category', 'manufacturer', 'model', 'serialNumber', 'placeId', 'locationNote', 'notes', 'warrantyUntil', 'purchaseDate'] as const) {
      if (i[k] !== undefined) patch[k] = i[k];
    }
    if (i.purchasePrice !== undefined) patch['purchasePrice'] = i.purchasePrice != null ? String(i.purchasePrice) : null;
    if (isReactivation) { patch['decommissionedAt'] = null; patch['decommissionReason'] = null; patch['disposalProceeds'] = null; }
    try {
      const [row] = await tx.update(ethelAssets).set(patch).where(eq(ethelAssets.id, id)).returning();
      return row ?? null;
    } catch (e: unknown) { asAssetWriteError(e); }
  });
}

export async function decommissionAsset(id: string, i: DecommissionInput): Promise<EthelAsset | null> {
  const existing = await getAsset(id);
  if (!existing) return null;
  if (existing.decommissionedAt) throw new Error('ALREADY_DECOMMISSIONED');
  const [row] = await db.update(ethelAssets).set({
    updatedAt: new Date(), decommissionedAt: i.date, decommissionReason: i.reason,
    disposalProceeds: i.proceeds != null ? String(i.proceeds) : null,
  }).where(eq(ethelAssets.id, id)).returning();
  return row ?? null;
}

export async function deleteAsset(id: string): Promise<EthelAsset | null> {
  try {
    const [row] = await db.delete(ethelAssets).where(eq(ethelAssets.id, id)).returning();
    return row ?? null;
  } catch (e: unknown) {
    // 23503 = foreign_key_violation, 23001 = restrict_violation (Postgres
    // raises either for ON DELETE RESTRICT — tests/feoh-schema.test.ts
    // documents both in this repo): feoh_item_costs.asset_id or
    // recurring_bills.ethel_asset_id — finance history exists.
    if (isPgError(e, '23503', '23001')) {
      throw new Error('HAS_FINANCE_LINKS');
    }
    throw e;
  }
}

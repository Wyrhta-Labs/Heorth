import { db } from '../../db/index.js';
import { inventoryItems, type InventoryItem } from './schema.js';
import { eq, and, isNull, isNotNull, ilike, or, sql } from 'drizzle-orm';
import type { CreateItemInput, UpdateItemInput, DecommissionInput } from './validators.js';

export async function listItems(q: {
  status?: 'active' | 'decommissioned'; category?: string; q?: string; limit?: number; offset?: number;
}): Promise<{ rows: InventoryItem[]; total: number; limit: number; offset: number }> {
  const conditions = [];
  if (q.status === 'active') conditions.push(isNull(inventoryItems.decommissionedAt));
  if (q.status === 'decommissioned') conditions.push(isNotNull(inventoryItems.decommissionedAt));
  if (q.category) conditions.push(eq(inventoryItems.category, q.category));
  if (q.q) {
    // Escape LIKE/ILIKE wildcards in user input (Postgres' default ESCAPE
    // character is backslash) so a literal "%" or "_" in a search term
    // doesn't act as a wildcard, e.g. searching "100%" must not match "1000".
    const escaped = q.q.replace(/[\\%_]/g, (c) => `\\${c}`);
    const pat = `%${escaped}%`;
    conditions.push(or(
      ilike(inventoryItems.name, pat), ilike(inventoryItems.manufacturer, pat),
      ilike(inventoryItems.model, pat), ilike(inventoryItems.serialNumber, pat),
    )!);
  }
  const where = conditions.length ? and(...conditions) : undefined;
  const limit = Math.min(100, Math.max(1, q.limit ?? 50));
  const offset = Math.max(0, q.offset ?? 0);
  const rows = await db.select().from(inventoryItems).where(where)
    .orderBy(inventoryItems.name).limit(limit).offset(offset);
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(inventoryItems).where(where);
  return { rows, total: count!, limit, offset };
}

export async function createItem(i: CreateItemInput): Promise<InventoryItem> {
  const [row] = await db.insert(inventoryItems).values({
    name: i.name, category: i.category ?? null, manufacturer: i.manufacturer ?? null,
    model: i.model ?? null, serialNumber: i.serialNumber ?? null, location: i.location ?? null,
    notes: i.notes ?? null, warrantyUntil: i.warrantyUntil ?? null,
    purchasePrice: i.purchasePrice != null ? String(i.purchasePrice) : null,
    purchaseDate: i.purchaseDate ?? null,
  }).returning();
  return row!;
}

export async function getItem(id: string): Promise<InventoryItem | null> {
  const [row] = await db.select().from(inventoryItems).where(eq(inventoryItems.id, id)).limit(1);
  return row ?? null;
}

/** The one sanctioned inventory->feoh touchpoint: a table-level existence
 *  read (no module import). Covered by tests so a rename breaks loudly.
 *  NOTE: this repo's postgres-js driver returns raw results as an ARRAY
 *  (RowList), not `{ rows }` — always `as unknown as Array<...>`. */
async function hasDisposalLink(itemId: string): Promise<boolean> {
  const rows = await db.execute(sql`SELECT 1 FROM feoh_item_costs WHERE item_id = ${itemId}::uuid AND kind = 'disposal' LIMIT 1`) as unknown as unknown[];
  return rows.length > 0;
}

export async function updateItem(id: string, i: UpdateItemInput): Promise<InventoryItem | null> {
  const isReactivation = 'decommissionedAt' in i;
  if (isReactivation && await hasDisposalLink(id)) throw new Error('DISPOSAL_LINK_EXISTS');
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  for (const k of ['name', 'category', 'manufacturer', 'model', 'serialNumber', 'location', 'notes', 'warrantyUntil', 'purchaseDate'] as const) {
    if (i[k] !== undefined) patch[k] = i[k];
  }
  if (i.purchasePrice !== undefined) patch['purchasePrice'] = i.purchasePrice != null ? String(i.purchasePrice) : null;
  if (isReactivation) { patch['decommissionedAt'] = null; patch['decommissionReason'] = null; patch['disposalProceeds'] = null; }
  const [row] = await db.update(inventoryItems).set(patch).where(eq(inventoryItems.id, id)).returning();
  return row ?? null;
}

export async function decommissionItem(id: string, i: DecommissionInput): Promise<InventoryItem | null> {
  const existing = await getItem(id);
  if (!existing) return null;
  if (existing.decommissionedAt) throw new Error('ALREADY_DECOMMISSIONED');
  const [row] = await db.update(inventoryItems).set({
    updatedAt: new Date(), decommissionedAt: i.date, decommissionReason: i.reason,
    disposalProceeds: i.proceeds != null ? String(i.proceeds) : null,
  }).where(eq(inventoryItems.id, id)).returning();
  return row ?? null;
}

export async function deleteItem(id: string): Promise<InventoryItem | null> {
  try {
    const [row] = await db.delete(inventoryItems).where(eq(inventoryItems.id, id)).returning();
    return row ?? null;
  } catch (e: unknown) {
    // 23503 = foreign_key_violation, 23001 = restrict_violation (Postgres
    // raises either for ON DELETE RESTRICT — tests/feoh-schema.test.ts
    // documents both in this repo): feoh_item_costs.item_id or
    // recurring_bills.inventory_item_id — finance history exists.
    if (e && typeof e === 'object' && 'code' in e
        && ['23503', '23001'].includes((e as { code: string }).code)) {
      throw new Error('HAS_FINANCE_LINKS');
    }
    throw e;
  }
}

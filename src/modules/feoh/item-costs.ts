import { db } from '../../db/index.js';
import { isPgError } from '../../db/pg-errors.js';
import { feohItemCosts, recurringBills, recurringOccurrences, transactions, type FeohItemCost, type Transaction, type RecurringBill } from './schema.js';
import { inventoryItems, type InventoryItem } from '../inventory/schema.js';
import { eq, and, isNotNull, inArray } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { localTodayIso } from './dates.js';

export type CostKind = 'purchase' | 'disposal' | 'repair' | 'maintenance' | 'accessory';
const TIER2: CostKind[] = ['repair', 'maintenance', 'accessory'];

const toCents = (s: string | null): number => (s == null ? 0 : Math.round(Number(s) * 100));

/** Spec: cost size = sum of debits over ENVELOPE postings, but only when the
 *  transaction also has an ACCOUNT posting (the feoh expense shape:
 *  envelope debit / account credit). Account-to-account transfers (no
 *  envelope posting) and envelope-to-envelope reallocations (no account
 *  posting) both yield 0. */
async function costSizeCents(transactionId: string): Promise<number> {
  const rows = await db.execute(sql`
    SELECT coalesce(sum(debit), 0) AS c FROM postings
    WHERE transaction_id = ${transactionId}::uuid AND envelope_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM postings a
                  WHERE a.transaction_id = ${transactionId}::uuid AND a.account_id IS NOT NULL)
  `) as unknown as Array<{ c: string }>;
  return toCents(rows[0]!.c);
}

export async function createItemCost(i: { transactionId: string; itemId: string; kind: CostKind }): Promise<FeohItemCost> {
  const [txn] = await db.select().from(transactions).where(eq(transactions.id, i.transactionId)).limit(1);
  if (!txn) throw new Error('NOT_FOUND_TRANSACTION');
  const [item] = await db.select().from(inventoryItems).where(eq(inventoryItems.id, i.itemId)).limit(1);
  if (!item) throw new Error('NOT_FOUND_ITEM');
  if (item.decommissionedAt && i.kind !== 'disposal') throw new Error('ITEM_DECOMMISSIONED');
  if (TIER2.includes(i.kind) && (await costSizeCents(i.transactionId)) === 0) throw new Error('NOT_A_COST');
  try {
    const [row] = await db.insert(feohItemCosts).values(i).returning();
    return row!;
  } catch (e: unknown) {
    if (isPgError(e, '23505')) {
      throw new Error('DUPLICATE_LINK');
    }
    throw e;
  }
}

export async function deleteItemCost(id: string): Promise<FeohItemCost | null> {
  const [row] = await db.delete(feohItemCosts).where(eq(feohItemCosts.id, id)).returning();
  return row ?? null;
}

export interface ItemCostsBreakdown {
  item: InventoryItem;
  links: Array<FeohItemCost & { transaction: Transaction }>;
  recurringBills: RecurringBill[];
  totals: { capital: number; tier2: number; recurring: number; proceeds: number; total: number; perYear: number | null; lifetimeDays: number | null };
}

export async function getItemCosts(itemId: string): Promise<ItemCostsBreakdown | null> {
  const [item] = await db.select().from(inventoryItems).where(eq(inventoryItems.id, itemId)).limit(1);
  if (!item) return null;

  const linkRows = await db.select().from(feohItemCosts)
    .innerJoin(transactions, eq(feohItemCosts.transactionId, transactions.id))
    .where(eq(feohItemCosts.itemId, itemId));
  const links = linkRows.map((r) => ({ ...r.feoh_item_costs, transaction: r.transactions }));

  const bills = await db.select().from(recurringBills).where(eq(recurringBills.inventoryItemId, itemId));
  const billIds = bills.map((b) => b.id);
  const paidTxIds = billIds.length
    ? (await db.select({ txId: recurringOccurrences.transactionId }).from(recurringOccurrences)
        .where(and(inArray(recurringOccurrences.billId, billIds), isNotNull(recurringOccurrences.transactionId))))
        .map((r) => r.txId!)
    : [];

  // Dedup by transactionId per item: tier2 attribution wins over recurring.
  const source = new Map<string, 'tier2' | 'recurring'>();
  for (const txId of paidTxIds) source.set(txId, 'recurring');
  for (const l of links) if (TIER2.includes(l.kind as CostKind)) source.set(l.transactionId, 'tier2');

  let tier2 = 0, recurring = 0;
  for (const [txId, bucket] of source) {
    const size = await costSizeCents(txId);
    if (bucket === 'tier2') tier2 += size; else recurring += size;
  }

  const capital = toCents(item.purchasePrice);
  const proceeds = toCents(item.disposalProceeds);
  const total = capital + tier2 + recurring - proceeds;

  let lifetimeDays: number | null = null;
  if (item.purchaseDate) {
    const end = item.decommissionedAt ?? localTodayIso();
    lifetimeDays = Math.round((Date.parse(end) - Date.parse(item.purchaseDate)) / 86_400_000);
  }
  const perYear = lifetimeDays != null && lifetimeDays >= 1 ? total / (lifetimeDays / 365.25) : null;

  const eur = (c: number) => c / 100;
  return {
    item, links, recurringBills: bills,
    totals: {
      capital: eur(capital), tier2: eur(tier2), recurring: eur(recurring), proceeds: eur(proceeds),
      total: eur(total), perYear: perYear != null ? Math.round(perYear) / 100 : null, lifetimeDays,
    },
  };
}

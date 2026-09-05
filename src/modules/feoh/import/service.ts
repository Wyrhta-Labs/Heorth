import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../../db/index.js';
import { config } from '../../../config/env.js';
import { recordTransaction, type Tx } from '../service.js';
import { matchRule } from './rules.js';
import {
  feohImportAccounts, feohImportRules, feohImportedTransactions,
  type ImportAccountMapping, type ImportRule, type ImportedTransactionRow, type ImportStatus,
} from './schema.js';
import type { ImportedTransaction } from './providers/types.js';

// ---------------------------------------------------------------- mappings

export function listAccountMappings(): Promise<ImportAccountMapping[]> {
  return db.select().from(feohImportAccounts).orderBy(asc(feohImportAccounts.sourceAccountId));
}

export async function upsertAccountMapping(i: { sourceAccountId: string; accountId: string }): Promise<ImportAccountMapping> {
  const [row] = await db.insert(feohImportAccounts)
    .values({ sourceAccountId: i.sourceAccountId, accountId: i.accountId })
    .onConflictDoUpdate({
      target: feohImportAccounts.sourceAccountId,
      set: { accountId: i.accountId, updatedAt: new Date() },
    })
    .returning();
  return row!;
}

export async function deleteAccountMapping(id: string): Promise<ImportAccountMapping | null> {
  const [row] = await db.delete(feohImportAccounts).where(eq(feohImportAccounts.id, id)).returning();
  return row ?? null;
}

// ------------------------------------------------------------------- rules

export function listRules(): Promise<ImportRule[]> {
  return db.select().from(feohImportRules).orderBy(asc(feohImportRules.priority), asc(feohImportRules.id));
}

export interface RuleInput { pattern: string; envelopeId: string; priority?: number; enabled?: boolean }

export async function createRule(i: RuleInput, createdBy: string): Promise<ImportRule> {
  const [row] = await db.insert(feohImportRules).values({
    pattern: i.pattern, envelopeId: i.envelopeId, priority: i.priority ?? 0, enabled: i.enabled ?? true, createdBy,
  }).returning();
  await reapplyRulesToPending();
  return row!;
}

export async function updateRule(id: string, i: Partial<RuleInput>): Promise<ImportRule | null> {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (i.pattern !== undefined) patch['pattern'] = i.pattern;
  if (i.envelopeId !== undefined) patch['envelopeId'] = i.envelopeId;
  if (i.priority !== undefined) patch['priority'] = i.priority;
  if (i.enabled !== undefined) patch['enabled'] = i.enabled;
  const [row] = await db.update(feohImportRules).set(patch).where(eq(feohImportRules.id, id)).returning();
  if (!row) return null;
  await reapplyRulesToPending();
  return row;
}

export async function deleteRule(id: string): Promise<ImportRule | null> {
  const [row] = await db.delete(feohImportRules).where(eq(feohImportRules.id, id)).returning();
  return row ?? null;
}

// ------------------------------------------------------------------- inbox

export async function listInbox(q: { status?: ImportStatus; limit?: number; offset?: number }) {
  const where = q.status ? eq(feohImportedTransactions.status, q.status) : undefined;
  const limit = Math.min(100, Math.max(1, q.limit ?? 50));
  const offset = Math.max(0, q.offset ?? 0);
  const rows = await db.select().from(feohImportedTransactions).where(where)
    .orderBy(desc(feohImportedTransactions.date), desc(feohImportedTransactions.createdAt))
    .limit(limit).offset(offset);
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(feohImportedTransactions).where(where);
  return { rows, total: count, limit, offset };
}

export async function getInboxRow(id: string): Promise<ImportedTransactionRow | null> {
  const [row] = await db.select().from(feohImportedTransactions).where(eq(feohImportedTransactions.id, id)).limit(1);
  return row ?? null;
}

export interface IngestResult { inserted: number; booked: number; skipped: number }

/**
 * The pipeline (spec §3). For every line: known source_id -> skip; else insert
 * `pending`; then try to auto-book (household currency + mapped account + rule
 * hit). Booking goes through `recordTransaction()` — never a direct posting write.
 */
export async function ingest(items: ImportedTransaction[]): Promise<IngestResult> {
  const result: IngestResult = { inserted: 0, booked: 0, skipped: 0 };
  if (items.length === 0) return result;

  const known = new Set((await db.select({ sourceId: feohImportedTransactions.sourceId })
    .from(feohImportedTransactions)
    .where(inArray(feohImportedTransactions.sourceId, items.map((i) => i.sourceId))))
    .map((r) => r.sourceId));
  const [mappings, rules] = await Promise.all([listAccountMappings(), listRules()]);
  const accountFor = new Map(mappings.map((m) => [m.sourceAccountId, m.accountId]));

  for (const item of items) {
    if (known.has(item.sourceId)) { result.skipped++; continue; }
    const [row] = await db.insert(feohImportedTransactions).values({
      sourceId: item.sourceId, sourceAccountId: item.sourceAccountId, date: item.date,
      payee: item.payee, memo: item.memo, amount: item.amount.toFixed(2), currency: item.currency,
      direction: item.direction, status: 'pending',
    }).onConflictDoNothing({ target: feohImportedTransactions.sourceId }).returning();
    if (!row) { result.skipped++; continue; } // raced with a concurrent tick
    result.inserted++;
    known.add(item.sourceId);

    if (row.currency !== config.feohCurrency) continue;
    const accountId = accountFor.get(row.sourceAccountId);
    if (!accountId) continue;
    const rule = matchRule(row.payee, rules);
    if (!rule) continue;
    await bookRow(row, rule.envelopeId, accountId, rule.createdBy, rule.id);
    result.booked++;
  }
  return result;
}

export interface ManualLineInput {
  sourceId?: string;
  sourceAccountId: string;
  date: string;
  payee: string;
  memo?: string | null;
  amount: number;
  currency?: string;
  direction: 'in' | 'out';
}

/** A hand-typed statement line (and how seed-demo.mjs fills the demo inbox). Same pipeline as a provider line. */
export async function addManualLine(i: ManualLineInput): Promise<{ row: ImportedTransactionRow; created: boolean }> {
  const sourceId = `manual:${i.sourceId ?? randomUUID()}`;
  const r = await ingest([{
    sourceId, sourceAccountId: i.sourceAccountId, date: i.date, payee: i.payee, memo: i.memo ?? null,
    amount: i.amount, currency: i.currency ?? config.feohCurrency, direction: i.direction,
  }]);
  const [row] = await db.select().from(feohImportedTransactions).where(eq(feohImportedTransactions.sourceId, sourceId)).limit(1);
  return { row: row!, created: r.inserted === 1 };
}

export async function confirmInboxRow(
  id: string,
  i: { envelopeId: string; accountId?: string },
  memberId: string,
): Promise<ImportedTransactionRow> {
  const row = await getInboxRow(id);
  if (!row) throw new Error('NOT_FOUND');
  if (row.status !== 'pending') throw new Error('NOT_PENDING');
  if (row.currency !== config.feohCurrency) throw new Error('CURRENCY_MISMATCH');
  let accountId = i.accountId;
  if (!accountId) {
    const [m] = await db.select().from(feohImportAccounts)
      .where(eq(feohImportAccounts.sourceAccountId, row.sourceAccountId)).limit(1);
    accountId = m?.accountId;
  }
  if (!accountId) throw new Error('ACCOUNT_UNMAPPED');
  const booked = await bookRow(row, i.envelopeId, accountId, memberId, null);
  // bookRow hands back the row untouched when it lost a race; a member asked
  // to book, so anything but `booked` is the same answer as the pre-check.
  if (booked.status !== 'booked') throw new Error('NOT_PENDING');
  return booked;
}

/**
 * Atomic transition: the UPDATE itself carries the `status = 'pending'` guard,
 * so a dismiss racing a confirm either wins outright or matches no row. Without
 * the guard it could set `dismissed` on a row confirm just booked and trip the
 * booked-pair CHECK — or overwrite the booking's status.
 */
export async function dismissInboxRow(id: string): Promise<ImportedTransactionRow> {
  const [updated] = await db.update(feohImportedTransactions)
    .set({ status: 'dismissed', updatedAt: new Date() })
    .where(and(eq(feohImportedTransactions.id, id), eq(feohImportedTransactions.status, 'pending')))
    .returning();
  if (updated) return updated;
  const row = await getInboxRow(id);
  if (!row) throw new Error('NOT_FOUND');
  throw new Error('NOT_PENDING');
}

/** Re-evaluate PENDING rows against the current rules. Booked rows are never touched (spec §4). */
export async function reapplyRulesToPending(): Promise<number> {
  const [pending, mappings, rules] = await Promise.all([
    db.select().from(feohImportedTransactions).where(eq(feohImportedTransactions.status, 'pending')),
    listAccountMappings(),
    listRules(),
  ]);
  const accountFor = new Map(mappings.map((m) => [m.sourceAccountId, m.accountId]));
  let booked = 0;
  for (const row of pending) {
    if (row.currency !== config.feohCurrency) continue;
    const accountId = accountFor.get(row.sourceAccountId);
    if (!accountId) continue;
    const rule = matchRule(row.payee, rules);
    if (!rule) continue;
    await bookRow(row, rule.envelopeId, accountId, rule.createdBy, rule.id);
    booked++;
  }
  return booked;
}

/**
 * Called by `deleteTransaction()` INSIDE its db.transaction and BEFORE the
 * DELETE: a booked import row goes back to `pending`, so the FK's SET NULL finds
 * nothing to null and the booked-pair check holds during the referential action.
 */
export async function revertBookedRows(tx: Tx, transactionId: string): Promise<number> {
  const rows = await tx.update(feohImportedTransactions)
    .set({ status: 'pending', transactionId: null, appliedRuleId: null, updatedAt: new Date() })
    .where(and(eq(feohImportedTransactions.transactionId, transactionId), eq(feohImportedTransactions.status, 'booked')))
    .returning({ id: feohImportedTransactions.id });
  return rows.length;
}

// ---------------------------------------------------------------- booking

/**
 * The one place an inbox row becomes ledger data — and ONE database
 * transaction: lock the row (`FOR UPDATE`) and re-check it is still pending,
 * write the ledger through `recordTransaction(…, tx)` on the same handle, mark
 * the row booked. All three commit or none do, so a crash can never leave a
 * ledger transaction without its inbox link (which dedup would then never
 * revisit). A concurrent tick or member on the same row blocks on the lock,
 * then sees it is no longer pending and returns it untouched.
 *
 * Exactly two postings, in the convention `reconcileAccount` and
 * `seed-demo.mjs` already use: out = envelope debit / account credit;
 * in = account debit / envelope credit.
 */
async function bookRow(
  row: ImportedTransactionRow,
  envelopeId: string,
  accountId: string,
  createdBy: string,
  appliedRuleId: string | null,
): Promise<ImportedTransactionRow> {
  return db.transaction(async (tx) => {
    const [locked] = await tx.select().from(feohImportedTransactions)
      .where(eq(feohImportedTransactions.id, row.id)).for('update');
    if (!locked) throw new Error('NOT_FOUND');
    if (locked.status !== 'pending') return locked; // raced: someone else booked or dismissed it
    const amount = Number(locked.amount);
    const postingsFor = locked.direction === 'out'
      ? [
          { envelopeId, accountId: null, debit: amount, credit: 0 },
          { accountId, envelopeId: null, debit: 0, credit: amount },
        ]
      : [
          { accountId, envelopeId: null, debit: amount, credit: 0 },
          { envelopeId, accountId: null, debit: 0, credit: amount },
        ];
    const { transaction } = await recordTransaction({
      date: locked.date, payee: locked.payee, memo: locked.memo, amount, postings: postingsFor, splits: [],
    }, createdBy, tx);
    const [updated] = await tx.update(feohImportedTransactions).set({
      status: 'booked', transactionId: transaction.id, envelopeId, appliedRuleId, updatedAt: new Date(),
    }).where(eq(feohImportedTransactions.id, locked.id)).returning();
    return updated!;
  });
}

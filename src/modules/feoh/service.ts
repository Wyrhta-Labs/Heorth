import { db } from '../../db/index.js';
import { accounts, envelopes, transactions, postings, expenseSplits, type Account, type Envelope, type Transaction } from './schema.js';
import { eq, and, gte, lte, desc, sql } from 'drizzle-orm';
import type { CreateAccountInput, CreateEnvelopeInput, RecordTransactionInput } from './validators.js';

export function listAccounts(): Promise<Account[]> {
  return db.select().from(accounts).orderBy(accounts.name);
}

export async function createAccount(i: CreateAccountInput): Promise<Account> {
  const [row] = await db.insert(accounts).values({
    name: i.name, kind: i.kind, openingBalance: String(i.openingBalance),
  }).returning();
  return row!;
}

export async function updateAccount(id: string, i: Partial<CreateAccountInput>): Promise<Account | null> {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (i.name !== undefined) patch['name'] = i.name;
  if (i.kind !== undefined) patch['kind'] = i.kind;
  if (i.openingBalance !== undefined) patch['openingBalance'] = String(i.openingBalance);
  const [row] = await db.update(accounts).set(patch).where(eq(accounts.id, id)).returning();
  return row ?? null;
}

export async function deleteAccount(id: string): Promise<Account | null> {
  const [row] = await db.delete(accounts).where(eq(accounts.id, id)).returning();
  return row ?? null;
}

export function listEnvelopes(): Promise<Envelope[]> {
  return db.select().from(envelopes).orderBy(envelopes.name);
}

export async function createEnvelope(i: CreateEnvelopeInput): Promise<Envelope> {
  const [row] = await db.insert(envelopes).values({
    name: i.name, monthlyBudget: String(i.monthlyBudget), tone: i.tone ?? null,
  }).returning();
  return row!;
}

export async function updateEnvelope(id: string, i: Partial<CreateEnvelopeInput>): Promise<Envelope | null> {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (i.name !== undefined) patch['name'] = i.name;
  if (i.monthlyBudget !== undefined) patch['monthlyBudget'] = String(i.monthlyBudget);
  if (i.tone !== undefined) patch['tone'] = i.tone;
  const [row] = await db.update(envelopes).set(patch).where(eq(envelopes.id, id)).returning();
  return row ?? null;
}

export async function deleteEnvelope(id: string): Promise<Envelope | null> {
  const [row] = await db.delete(envelopes).where(eq(envelopes.id, id)).returning();
  return row ?? null;
}

const TOLERANCE = 0.005;

export function postingsBalance(rows: Array<{ debit: number; credit: number }>): boolean {
  const debit = rows.reduce((s, p) => s + p.debit, 0);
  const credit = rows.reduce((s, p) => s + p.credit, 0);
  return Math.abs(debit - credit) < TOLERANCE;
}

export async function recordTransaction(input: RecordTransactionInput, createdBy: string) {
  if (!postingsBalance(input.postings)) {
    throw new Error('UNBALANCED');
  }
  return db.transaction(async (tx) => {
    const [txn] = await tx.insert(transactions).values({
      date: input.date, payee: input.payee, memo: input.memo ?? null,
      amount: String(input.amount), createdBy,
    }).returning();

    const postingRows = await tx.insert(postings).values(
      input.postings.map((p) => ({
        transactionId: txn!.id,
        accountId: p.accountId ?? null,
        envelopeId: p.envelopeId ?? null,
        debit: String(p.debit),
        credit: String(p.credit),
      })),
    ).returning();

    let splitRows: Array<typeof expenseSplits.$inferSelect> = [];
    if (input.splits && input.splits.length > 0) {
      splitRows = await tx.insert(expenseSplits).values(
        input.splits.map((s) => ({ transactionId: txn!.id, memberId: s.memberId, share: String(s.share) })),
      ).returning();
    }

    return { transaction: txn!, postings: postingRows, splits: splitRows };
  });
}

export async function listTransactions(q: { from?: string; to?: string; limit?: number; offset?: number }) {
  const conditions = [];
  if (q.from) conditions.push(gte(transactions.date, q.from));
  if (q.to) conditions.push(lte(transactions.date, q.to));
  const where = conditions.length ? and(...conditions) : undefined;
  const limit = Math.min(100, Math.max(1, q.limit ?? 20));
  const offset = Math.max(0, q.offset ?? 0);
  const rows = await db.select().from(transactions).where(where).orderBy(desc(transactions.date)).limit(limit).offset(offset);
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(transactions).where(where);
  return { rows, total: count, limit, offset };
}

export async function getTransaction(id: string) {
  const [txn] = await db.select().from(transactions).where(eq(transactions.id, id)).limit(1);
  if (!txn) return null;
  const postingRows = await db.select().from(postings).where(eq(postings.transactionId, id));
  const splitRows = await db.select().from(expenseSplits).where(eq(expenseSplits.transactionId, id));
  return { transaction: txn, postings: postingRows, splits: splitRows };
}

export async function deleteTransaction(id: string): Promise<Transaction | null> {
  const [row] = await db.delete(transactions).where(eq(transactions.id, id)).returning();
  return row ?? null;
}

export async function getMonthSummary(month: string) {
  const from = `${month}-01`;
  // exclusive upper bound = first day of next month
  const [y, m] = month.split('-').map(Number);
  const next = m === 12 ? `${y! + 1}-01-01` : `${y}-${String(m! + 1).padStart(2, '0')}-01`;

  const envRows = await db.select().from(envelopes).orderBy(envelopes.name);

  const spendRows = await db
    .select({
      envelopeId: postings.envelopeId,
      spent: sql<string>`coalesce(sum(${postings.debit}), 0)`,
    })
    .from(postings)
    .innerJoin(transactions, eq(postings.transactionId, transactions.id))
    .where(and(gte(transactions.date, from), lte(transactions.date, next), sql`${transactions.date} < ${next}`))
    .groupBy(postings.envelopeId);

  const spentByEnvelope = new Map(spendRows.map((r) => [r.envelopeId, Number(r.spent)]));

  const envelopesOut = envRows.map((e) => {
    const budget = Number(e.monthlyBudget);
    const spent = spentByEnvelope.get(e.id) ?? 0;
    return { envelopeId: e.id, name: e.name, tone: e.tone, budget, spent, remaining: budget - spent };
  });

  const totals = envelopesOut.reduce(
    (acc, e) => ({ budget: acc.budget + e.budget, spent: acc.spent + e.spent, remaining: acc.remaining + e.remaining }),
    { budget: 0, spent: 0, remaining: 0 },
  );

  return { month, envelopes: envelopesOut, totals };
}

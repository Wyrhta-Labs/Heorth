import { db } from '../../db/index.js';
import { accounts, envelopes, transactions, postings, expenseSplits, recurringBills, type Account, type Envelope, type Transaction, type RecurringBill } from './schema.js';
import { eq, and, gte, lte, desc, sql } from 'drizzle-orm';
import type { CreateAccountInput, CreateEnvelopeInput, RecordTransactionInput, CreateBillInput } from './validators.js';
import { toCsv, parseCsv, sanitizeCsvText } from './csv.js';

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

// `createdBy` is the acting household member's id, supplied by the caller
// (derived from the request's auth principal) rather than read from the
// input body — see validators.ts. The FK on `transactions.createdBy` is the
// backstop for a bad id; there is deliberately no pre-check here (unlike
// Feoh's standalone `parties` boundary, which pre-checked because it had no
// per-member auth to derive the id from).
export async function recordTransaction(input: RecordTransactionInput, createdBy: string) {
  if (!postingsBalance(input.postings)) {
    throw new Error('UNBALANCED');
  }
  if (input.postings.some((p) => !p.accountId && !p.envelopeId)) {
    throw new Error('ORPHAN_POSTING');
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

export function listBills(): Promise<RecurringBill[]> {
  return db.select().from(recurringBills).orderBy(recurringBills.nextDue);
}

export async function createBill(i: CreateBillInput): Promise<RecurringBill> {
  const [row] = await db.insert(recurringBills).values({
    payee: i.payee, amount: String(i.amount), cadence: i.cadence,
    nextDue: i.nextDue, envelopeId: i.envelopeId ?? null,
  }).returning();
  return row!;
}

export async function updateBill(id: string, i: Partial<CreateBillInput>): Promise<RecurringBill | null> {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (i.payee !== undefined) patch['payee'] = i.payee;
  if (i.amount !== undefined) patch['amount'] = String(i.amount);
  if (i.cadence !== undefined) patch['cadence'] = i.cadence;
  if (i.nextDue !== undefined) patch['nextDue'] = i.nextDue;
  if (i.envelopeId !== undefined) patch['envelopeId'] = i.envelopeId;
  const [row] = await db.update(recurringBills).set(patch).where(eq(recurringBills.id, id)).returning();
  return row ?? null;
}

export async function deleteBill(id: string): Promise<RecurringBill | null> {
  const [row] = await db.delete(recurringBills).where(eq(recurringBills.id, id)).returning();
  return row ?? null;
}

const CSV_HEADER = ['date', 'payee', 'memo', 'amount', 'envelope', 'account'];

export async function exportTransactionsCsv(): Promise<string> {
  const txns = await db.select().from(transactions).orderBy(transactions.date);
  const allPostings = await db.select().from(postings);
  const accountRows = await db.select().from(accounts);
  const envelopeRows = await db.select().from(envelopes);
  const accountName = new Map(accountRows.map((a) => [a.id, a.name]));
  const envelopeName = new Map(envelopeRows.map((e) => [e.id, e.name]));

  const rows: string[][] = [CSV_HEADER];
  for (const t of txns) {
    const ps = allPostings.filter((p) => p.transactionId === t.id);
    const envPostings = ps.filter((p) => p.envelopeId);
    const acctPosting = ps.find((p) => p.accountId);
    const acctName = acctPosting?.accountId ? (accountName.get(acctPosting.accountId) ?? '') : '';

    if (envPostings.length > 0) {
      for (const ep of envPostings) {
        rows.push([
          t.date, sanitizeCsvText(t.payee), sanitizeCsvText(t.memo ?? ''), ep.debit,
          sanitizeCsvText(ep.envelopeId ? (envelopeName.get(ep.envelopeId) ?? '') : ''),
          sanitizeCsvText(acctName),
        ]);
      }
    } else {
      rows.push([
        t.date, sanitizeCsvText(t.payee), sanitizeCsvText(t.memo ?? ''), t.amount,
        '',
        sanitizeCsvText(acctName),
      ]);
    }
  }
  return toCsv(rows);
}

/** Verify a YYYY-MM-DD string is a real calendar date (rejects e.g. 2026-99-99, 2026-02-30). */
function isValidCalendarDate(date: string): boolean {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m! - 1 && dt.getUTCDate() === d;
}

export async function importTransactionsCsv(text: string, createdBy: string): Promise<{ imported: number }> {
  const matrix = parseCsv(text);
  if (matrix.length === 0) return { imported: 0 };
  const [header, ...dataRows] = matrix;
  const idx = (name: string) => header!.indexOf(name);
  const di = idx('date'), pi = idx('payee'), mi = idx('memo'), ai = idx('amount'), ei = idx('envelope'), aci = idx('account');

  if (di < 0 || pi < 0 || ai < 0) {
    throw new Error('CSV_INVALID_HEADER');
  }

  const envelopeRows = await db.select().from(envelopes);
  const accountRows = await db.select().from(accounts);
  const envByName = new Map(envelopeRows.map((e) => [e.name, e.id]));
  const acctByName = new Map(accountRows.map((a) => [a.name, a.id]));

  // Validation/resolution pass: resolve every row's envelope/account names,
  // validate date/amount, and confirm at least one reference is present up
  // front, throwing before writing anything, so a bad row never leaves a
  // partial import committed.
  const resolved = dataRows.map((r) => {
    const date = r[di]!;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !isValidCalendarDate(date)) throw new Error('CSV_INVALID_ROW');

    const rawAmount = r[ai];
    if (rawAmount === undefined || !Number.isFinite(Number(rawAmount))) throw new Error('CSV_INVALID_ROW');
    const amount = Number(rawAmount);

    const envelopeName = ei >= 0 ? r[ei] ?? '' : '';
    const accountName = aci >= 0 ? r[aci] ?? '' : '';

    let envelopeId: string | null = null;
    if (envelopeName) {
      envelopeId = envByName.get(envelopeName) ?? null;
      if (envelopeId === null) throw new Error('UNKNOWN_REFERENCE');
    }

    let accountId: string | null = null;
    if (accountName) {
      accountId = acctByName.get(accountName) ?? null;
      if (accountId === null) throw new Error('UNKNOWN_REFERENCE');
    }

    if (!envelopeId && !accountId) throw new Error('CSV_INVALID_ROW');

    return {
      date, payee: r[pi]!, memo: r[mi] || null, amount,
      envelopeId, accountId,
    };
  });

  // Write pass: all names resolved, safe to record each transaction.
  let imported = 0;
  for (const row of resolved) {
    await recordTransaction({
      date: row.date, payee: row.payee, memo: row.memo, amount: row.amount,
      postings: [
        { envelopeId: row.envelopeId, accountId: null, debit: row.amount, credit: 0 },
        { accountId: row.accountId, envelopeId: null, debit: 0, credit: row.amount },
      ],
      splits: [],
    }, createdBy);
    imported += 1;
  }
  return { imported };
}

export async function exportLedger(): Promise<string> {
  const txns = await db.select().from(transactions).orderBy(transactions.date);
  const allPostings = await db.select().from(postings);
  const accountRows = await db.select().from(accounts);
  const envelopeRows = await db.select().from(envelopes);
  const accountName = new Map(accountRows.map((a) => [a.id, a.name]));
  const envelopeName = new Map(envelopeRows.map((e) => [e.id, e.name]));

  const blocks: string[] = [];
  for (const t of txns) {
    const lines: string[] = [`${t.date} * ${t.payee}`];
    if (t.memo) lines.push(`    ; ${t.memo}`);
    for (const p of allPostings.filter((x) => x.transactionId === t.id)) {
      const label = p.envelopeId
        ? `Envelopes:${envelopeName.get(p.envelopeId) ?? 'Unknown'}`
        : `Accounts:${p.accountId ? accountName.get(p.accountId) ?? 'Unknown' : 'Unknown'}`;
      const net = Number(p.debit) - Number(p.credit);
      lines.push(`    ${label}  ${net >= 0 ? '' : '-'}$${Math.abs(net).toFixed(2)}`);
    }
    blocks.push(lines.join('\n'));
  }
  return blocks.join('\n\n');
}

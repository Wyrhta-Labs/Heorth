// Per-account ledger with a running balance computed via a Postgres window
// function (Task 12). The running-balance window is deliberately computed
// over the FULL account history (unfiltered, unpaginated) so that page N's
// balances agree with what the full listing would have shown — from/to/
// limit/offset only trim the ROWS returned, never the window they're summed
// over. See src/modules/feoh/schema.ts for postings/transactions/accounts.
import { db } from '../../db/index.js';
import { accounts } from './schema.js';
import { eq, sql } from 'drizzle-orm';

export interface LedgerEntry {
  transactionId: string;
  date: string;
  payee: string;
  memo: string | null;
  delta: number;
  balance: number;
}

export interface LedgerQuery {
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface LedgerResult {
  entries: LedgerEntry[];
  meta: { total: number; limit: number; offset: number; openingBalance: number; endBalance: number };
}

const toCents = (s: string | number | null): number => (s == null ? 0 : Math.round(Number(s) * 100));

export async function getAccountLedger(accountId: string, q: LedgerQuery): Promise<LedgerResult | null> {
  const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId)).limit(1);
  if (!account) return null;
  const opening = toCents(account.openingBalance);
  const limit = Math.min(100, Math.max(1, q.limit ?? 50));
  const offset = Math.max(0, q.offset ?? 0);

  // Per-transaction delta on this account, running balance over the FULL
  // history (window computed before from/offset filtering so page N balances
  // are correct), deterministic (date, created_at, id) order.
  const rows = await db.execute(sql`
    WITH entries AS (
      SELECT t.id AS transaction_id, t.date, t.payee, t.memo, t.created_at,
             sum(p.debit - p.credit) AS delta
      FROM postings p JOIN transactions t ON t.id = p.transaction_id
      WHERE p.account_id = ${accountId}::uuid
      GROUP BY t.id, t.date, t.payee, t.memo, t.created_at
    ), running AS (
      SELECT *, sum(delta) OVER (ORDER BY date, created_at, transaction_id
                                 ROWS UNBOUNDED PRECEDING) AS cum
      FROM entries
    )
    SELECT transaction_id, date, payee, memo, delta, cum
    FROM running
    WHERE (${q.from ?? null}::date IS NULL OR date >= ${q.from ?? null}::date)
      AND (${q.to ?? null}::date IS NULL OR date <= ${q.to ?? null}::date)
    ORDER BY date, created_at, transaction_id
    LIMIT ${limit} OFFSET ${offset}`) as unknown as Array<Record<string, unknown>>;

  // Separate filtered count: a window count(*) OVER () would report 0 for an
  // empty page past the end, breaking pagination meta.
  const countRows = await db.execute(sql`
    SELECT count(DISTINCT t.id)::int AS total
    FROM postings p JOIN transactions t ON t.id = p.transaction_id
    WHERE p.account_id = ${accountId}::uuid
      AND (${q.from ?? null}::date IS NULL OR t.date >= ${q.from ?? null}::date)
      AND (${q.to ?? null}::date IS NULL OR t.date <= ${q.to ?? null}::date)`) as unknown as Array<{ total: number }>;
  const total = countRows[0]!.total;

  const endRows = await db.execute(sql`
    SELECT coalesce(sum(p.debit - p.credit), 0) AS s
    FROM postings p JOIN transactions t ON t.id = p.transaction_id
    WHERE p.account_id = ${accountId}::uuid
      AND (${q.to ?? null}::date IS NULL OR t.date <= ${q.to ?? null}::date)`) as unknown as Array<{ s: string }>;
  const endBalance = opening + toCents(endRows[0]!.s);

  const entries: LedgerEntry[] = rows.map((r) => ({
    transactionId: String(r['transaction_id']),
    date: String(r['date']).slice(0, 10),
    payee: String(r['payee']),
    memo: r['memo'] == null ? null : String(r['memo']),
    delta: toCents(r['delta'] as string) / 100,
    balance: (opening + toCents(r['cum'] as string)) / 100,
  }));
  return { entries, meta: { total, limit, offset, openingBalance: opening / 100, endBalance: endBalance / 100 } };
}

export async function ledgerBalanceCents(accountId: string, throughDate: string): Promise<number> {
  const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId)).limit(1);
  if (!account) throw new Error('NOT_FOUND_ACCOUNT');
  const rows = await db.execute(sql`
    SELECT coalesce(sum(p.debit - p.credit), 0) AS s
    FROM postings p JOIN transactions t ON t.id = p.transaction_id
    WHERE p.account_id = ${accountId}::uuid AND t.date <= ${throughDate}::date`) as unknown as Array<{ s: string }>;
  return toCents(account.openingBalance) + toCents(rows[0]!.s);
}

// Per-account ledger with a window-function running balance (Task 12).
import { describe, it, expect } from 'vitest';
import { seedTestHousehold, authHeaders } from './helpers.js';
import * as service from '../src/modules/feoh/service.js';
import { getAccountLedger, ledgerBalanceCents } from '../src/modules/feoh/ledger.js';
import { createApp } from '../src/app.js';
import { ALL_MODULES } from '../src/modules/index.js';

const app = createApp(ALL_MODULES);

interface JsonBody { data?: unknown; error?: { code: string; message: string } }
async function json(res: Response): Promise<JsonBody> {
  return (await res.json()) as JsonBody;
}

async function setup() {
  const { adult, child } = await seedTestHousehold();
  const account = await service.createAccount({ name: 'Checking', kind: 'asset', openingBalance: 100 });
  const envelope = await service.createEnvelope({ name: 'Household', monthlyBudget: 400 });
  return { adult, child, account, envelope };
}

async function expenseTx(adultId: string, envelopeId: string, accountId: string, amount: number, date: string, payee = 'Expense') {
  const result = await service.recordTransaction({
    date, payee, amount, memo: null,
    postings: [
      { envelopeId, accountId: null, debit: amount, credit: 0 },
      { accountId, envelopeId: null, debit: 0, credit: amount },
    ],
    splits: [],
  }, adultId);
  return result.transaction;
}

async function incomeTx(adultId: string, envelopeId: string, accountId: string, amount: number, date: string, payee = 'Income') {
  const result = await service.recordTransaction({
    date, payee, amount, memo: null,
    postings: [
      { accountId, envelopeId: null, debit: amount, credit: 0 },
      { envelopeId, accountId: null, debit: 0, credit: amount },
    ],
    splits: [],
  }, adultId);
  return result.transaction;
}

describe('feoh account ledger', () => {
  it('runs the balance across the full history in deterministic order (date, created_at, id tie-break)', async () => {
    const { adult, account, envelope } = await setup();
    // opening 100; three transactions, two sharing the same date (2026-08-05)
    // to exercise the (date, created_at, transaction_id) tie-break.
    const t1 = await expenseTx(adult.user.id, envelope.id, account.id, 30, '2026-08-01', 'Groceries'); // -> 70
    const t2 = await expenseTx(adult.user.id, envelope.id, account.id, 10, '2026-08-05', 'Coffee'); // -> 60
    const t3 = await incomeTx(adult.user.id, envelope.id, account.id, 50, '2026-08-05', 'Refund'); // -> 110

    const ledger = await getAccountLedger(account.id, {});
    expect(ledger).not.toBeNull();
    const entries = ledger!.entries;
    expect(entries.map((e) => e.transactionId)).toEqual([t1.id, t2.id, t3.id]);
    expect(entries.map((e) => e.balance)).toEqual([70, 60, 110]);
    expect(ledger!.meta.openingBalance).toBe(100);
    expect(ledger!.meta.endBalance).toBe(110);
    expect(ledger!.meta.total).toBe(3);
  });

  it('reports the SAME balance for a middle entry under limit/offset pagination as in the full listing', async () => {
    const { adult, account, envelope } = await setup();
    await expenseTx(adult.user.id, envelope.id, account.id, 30, '2026-08-01', 'Groceries'); // -> 70
    const t2 = await expenseTx(adult.user.id, envelope.id, account.id, 10, '2026-08-05', 'Coffee'); // -> 60
    await incomeTx(adult.user.id, envelope.id, account.id, 50, '2026-08-05', 'Refund'); // -> 110

    const full = await getAccountLedger(account.id, {});
    const page2 = await getAccountLedger(account.id, { limit: 1, offset: 1 });
    expect(page2).not.toBeNull();
    expect(page2!.entries).toHaveLength(1);
    expect(page2!.entries[0]!.transactionId).toBe(t2.id);
    expect(page2!.entries[0]!.balance).toBe(full!.entries[1]!.balance);
    expect(page2!.meta.total).toBe(3);
    expect(page2!.meta.limit).toBe(1);
    expect(page2!.meta.offset).toBe(1);
  });

  it('keeps correct balances (running over full history) when filtering by `from`', async () => {
    const { adult, account, envelope } = await setup();
    await expenseTx(adult.user.id, envelope.id, account.id, 30, '2026-08-01', 'Groceries'); // -> 70
    const t2 = await expenseTx(adult.user.id, envelope.id, account.id, 10, '2026-08-05', 'Coffee'); // -> 60
    const t3 = await incomeTx(adult.user.id, envelope.id, account.id, 50, '2026-08-05', 'Refund'); // -> 110

    const filtered = await getAccountLedger(account.id, { from: '2026-08-05' });
    expect(filtered).not.toBeNull();
    expect(filtered!.entries.map((e) => e.transactionId)).toEqual([t2.id, t3.id]);
    expect(filtered!.entries.map((e) => e.balance)).toEqual([60, 110]);
    expect(filtered!.meta.total).toBe(2);
  });

  it('computes endBalance through `to` (or all)', async () => {
    const { adult, account, envelope } = await setup();
    await expenseTx(adult.user.id, envelope.id, account.id, 30, '2026-08-01', 'Groceries'); // -> 70
    await expenseTx(adult.user.id, envelope.id, account.id, 10, '2026-08-05', 'Coffee'); // -> 60
    await incomeTx(adult.user.id, envelope.id, account.id, 50, '2026-08-05', 'Refund'); // -> 110

    const throughFirst = await getAccountLedger(account.id, { to: '2026-08-01' });
    expect(throughFirst!.meta.endBalance).toBe(70);

    const all = await getAccountLedger(account.id, {});
    expect(all!.meta.endBalance).toBe(110);
  });

  it('ledgerBalanceCents returns opening + sum of deltas through the given date', async () => {
    const { adult, account, envelope } = await setup();
    await expenseTx(adult.user.id, envelope.id, account.id, 30, '2026-08-01', 'Groceries'); // -> 70
    await expenseTx(adult.user.id, envelope.id, account.id, 10, '2026-08-05', 'Coffee'); // -> 60

    expect(await ledgerBalanceCents(account.id, '2026-08-01')).toBe(7000);
    expect(await ledgerBalanceCents(account.id, '2026-08-05')).toBe(6000);
  });

  it('collapses a transaction with TWO postings on the same account into ONE ledger entry (GROUP BY correctness)', async () => {
    const { adult, account, envelope } = await setup();
    // Both legs on the ledger account (debit 30 + debit 20), balanced by a
    // single envelope credit of 50 (Sigma debit = Sigma credit = 50). This is
    // the exact scenario the ledger query's `GROUP BY t.id, ...` protects
    // against: a naive per-posting listing would show two rows for this
    // transaction instead of one summed row.
    const result = await service.recordTransaction({
      date: '2026-08-10', payee: 'Split deposit', amount: 50, memo: null,
      postings: [
        { accountId: account.id, envelopeId: null, debit: 30, credit: 0 },
        { accountId: account.id, envelopeId: null, debit: 20, credit: 0 },
        { envelopeId: envelope.id, accountId: null, debit: 0, credit: 50 },
      ],
      splits: [],
    }, adult.user.id);
    const txn = result.transaction;

    const ledger = await getAccountLedger(account.id, {});
    expect(ledger).not.toBeNull();
    const matches = ledger!.entries.filter((e) => e.transactionId === txn.id);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.delta).toBe(50);
    expect(matches[0]!.balance).toBe(150); // opening 100 + 50
    expect(ledger!.meta.total).toBe(1);
    expect(ledger!.meta.endBalance).toBe(150);
    expect(await ledgerBalanceCents(account.id, '2026-08-10')).toBe(15000);
  });

  it('returns null for an unknown account (service) and 404 at the route', async () => {
    const { adult } = await setup();
    const missing = await getAccountLedger('00000000-0000-0000-0000-000000000000', {});
    expect(missing).toBeNull();

    const res = await app.request('/api/v1/feoh/accounts/00000000-0000-0000-0000-000000000000/ledger', {
      headers: authHeaders(adult.jwt),
    });
    expect(res.status).toBe(404);
    expect((await json(res)).error?.code).toBe('NOT_FOUND');
  });

  it('GET /accounts/:id/ledger returns entries and meta for a real account', async () => {
    const { adult, account, envelope } = await setup();
    await expenseTx(adult.user.id, envelope.id, account.id, 30, '2026-08-01', 'Groceries');

    const res = await app.request(`/api/v1/feoh/accounts/${account.id}/ledger`, {
      headers: authHeaders(adult.jwt),
    });
    expect(res.status).toBe(200);
    const body = (await json(res)) as { data: unknown; error?: { code: string } };
    expect(Array.isArray(body.data)).toBe(true);
  });
});

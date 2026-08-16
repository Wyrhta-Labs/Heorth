// Kassensturz reconciliation (Task 13): books an adjusting transaction
// between the counted cash balance and the ledger balance through a given
// date, guarded against later postings that would silently shift.
import { describe, it, expect } from 'vitest';
import { seedTestHousehold, authHeaders } from './helpers.js';
import * as service from '../src/modules/feoh/service.js';
import { ledgerBalanceCents } from '../src/modules/feoh/ledger.js';
import { createApp } from '../src/app.js';
import { ALL_MODULES } from '../src/modules/index.js';

const app = createApp(ALL_MODULES);

interface JsonBody { data?: unknown; error?: { code: string; message: string } }
async function json(res: Response): Promise<JsonBody> {
  return (await res.json()) as JsonBody;
}

function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y!, m! - 1, d!);
  dt.setDate(dt.getDate() + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

async function setup() {
  const { adult, child } = await seedTestHousehold();
  const account = await service.createAccount({ name: 'Cash Wallet', kind: 'asset', openingBalance: 100 });
  const liability = await service.createAccount({ name: 'Credit Card', kind: 'liability', openingBalance: 0 });
  const envelope = await service.createEnvelope({ name: 'Sonstiges', monthlyBudget: 0 });
  return { adult, child, account, liability, envelope };
}

describe('feoh Kassensturz reconciliation', () => {
  it('(a) counted > ledger books a Kassensturz transaction (account debit / envelope credit), positive difference, ledger balance now equals counted', async () => {
    const { adult, account, envelope } = await setup();
    const today = localToday();

    const res = await app.request(`/api/v1/feoh/accounts/${account.id}/reconcile`, {
      method: 'POST',
      headers: { ...authHeaders(adult.jwt), 'Content-Type': 'application/json' },
      body: JSON.stringify({ countedBalance: 150, date: today, envelopeId: envelope.id }),
    });
    expect(res.status).toBe(200);
    const body = (await json(res)) as { data: { difference: number; transaction: { transaction: { id: string }; postings: Array<{ accountId: string | null; envelopeId: string | null; debit: string; credit: string }> } } };
    expect(body.data.difference).toBe(50);
    expect(body.data.transaction).not.toBeNull();
    expect(body.data.transaction.transaction.payee).toBe('Kassensturz');
    const postings = body.data.transaction.postings;
    const acctPosting = postings.find((p) => p.accountId === account.id)!;
    const envPosting = postings.find((p) => p.envelopeId === envelope.id)!;
    expect(Number(acctPosting.debit)).toBe(50);
    expect(Number(acctPosting.credit)).toBe(0);
    expect(Number(envPosting.credit)).toBe(50);
    expect(Number(envPosting.debit)).toBe(0);

    expect(await ledgerBalanceCents(account.id, today)).toBe(15000);
  });

  it('(b) counted < ledger books the mirrored posting shape (account credit / envelope debit), negative difference', async () => {
    const { adult, account, envelope } = await setup();
    const today = localToday();

    const res = await app.request(`/api/v1/feoh/accounts/${account.id}/reconcile`, {
      method: 'POST',
      headers: { ...authHeaders(adult.jwt), 'Content-Type': 'application/json' },
      body: JSON.stringify({ countedBalance: 60, date: today, envelopeId: envelope.id }),
    });
    expect(res.status).toBe(200);
    const body = (await json(res)) as { data: { difference: number; transaction: { transaction: { id: string }; postings: Array<{ accountId: string | null; envelopeId: string | null; debit: string; credit: string }> } } };
    expect(body.data.difference).toBe(-40);
    expect(body.data.transaction).not.toBeNull();
    const postings = body.data.transaction.postings;
    const acctPosting = postings.find((p) => p.accountId === account.id)!;
    const envPosting = postings.find((p) => p.envelopeId === envelope.id)!;
    expect(Number(acctPosting.credit)).toBe(40);
    expect(Number(acctPosting.debit)).toBe(0);
    expect(Number(envPosting.debit)).toBe(40);
    expect(Number(envPosting.credit)).toBe(0);

    expect(await ledgerBalanceCents(account.id, today)).toBe(6000);
  });

  it('(c) difference 0 -> transaction: null, no new transaction row', async () => {
    const { adult, account, envelope } = await setup();
    const today = localToday();

    const before = await service.listTransactions({});
    const res = await app.request(`/api/v1/feoh/accounts/${account.id}/reconcile`, {
      method: 'POST',
      headers: { ...authHeaders(adult.jwt), 'Content-Type': 'application/json' },
      body: JSON.stringify({ countedBalance: 100, date: today, envelopeId: envelope.id }),
    });
    expect(res.status).toBe(200);
    const body = (await json(res)) as { data: { difference: number; transaction: unknown } };
    expect(body.data.difference).toBe(0);
    expect(body.data.transaction).toBeNull();

    const after = await service.listTransactions({});
    expect(after.total).toBe(before.total);
  });

  it('(d) a posting dated between `date` and today blocks reconciliation with 409 LATER_TRANSACTIONS_EXIST', async () => {
    const { adult, account, envelope } = await setup();
    const today = localToday();
    const reconcileDate = addDays(today, -5);
    const inBetweenDate = addDays(today, -2);

    await service.recordTransaction({
      date: inBetweenDate, payee: 'Groceries', amount: 10, memo: null,
      postings: [
        { envelopeId: envelope.id, accountId: null, debit: 10, credit: 0 },
        { accountId: account.id, envelopeId: null, debit: 0, credit: 10 },
      ],
      splits: [],
    }, adult.user.id);

    const res = await app.request(`/api/v1/feoh/accounts/${account.id}/reconcile`, {
      method: 'POST',
      headers: { ...authHeaders(adult.jwt), 'Content-Type': 'application/json' },
      body: JSON.stringify({ countedBalance: 100, date: reconcileDate, envelopeId: envelope.id }),
    });
    expect(res.status).toBe(409);
    expect((await json(res)).error?.code).toBe('LATER_TRANSACTIONS_EXIST');
  });

  it('(e) a FUTURE-dated posting (> today) does NOT block reconciling today', async () => {
    const { adult, account, envelope } = await setup();
    const today = localToday();
    const futureDate = addDays(today, 5);

    await service.recordTransaction({
      date: futureDate, payee: 'Future planned expense', amount: 10, memo: null,
      postings: [
        { envelopeId: envelope.id, accountId: null, debit: 10, credit: 0 },
        { accountId: account.id, envelopeId: null, debit: 0, credit: 10 },
      ],
      splits: [],
    }, adult.user.id);

    const res = await app.request(`/api/v1/feoh/accounts/${account.id}/reconcile`, {
      method: 'POST',
      headers: { ...authHeaders(adult.jwt), 'Content-Type': 'application/json' },
      body: JSON.stringify({ countedBalance: 100, date: today, envelopeId: envelope.id }),
    });
    expect(res.status).toBe(200);
    const body = (await json(res)) as { data: { difference: number; transaction: unknown } };
    expect(body.data.difference).toBe(0);
    expect(body.data.transaction).toBeNull();
  });

  it('(f) a liability account cannot be reconciled -> 400 ACCOUNT_NOT_ASSET', async () => {
    const { adult, liability, envelope } = await setup();
    const today = localToday();

    const res = await app.request(`/api/v1/feoh/accounts/${liability.id}/reconcile`, {
      method: 'POST',
      headers: { ...authHeaders(adult.jwt), 'Content-Type': 'application/json' },
      body: JSON.stringify({ countedBalance: 0, date: today, envelopeId: envelope.id }),
    });
    expect(res.status).toBe(400);
    expect((await json(res)).error?.code).toBe('ACCOUNT_NOT_ASSET');
  });

  it('(g) `date` in the future -> 400 VALIDATION_ERROR', async () => {
    const { adult, account, envelope } = await setup();
    const futureDate = addDays(localToday(), 5);

    const res = await app.request(`/api/v1/feoh/accounts/${account.id}/reconcile`, {
      method: 'POST',
      headers: { ...authHeaders(adult.jwt), 'Content-Type': 'application/json' },
      body: JSON.stringify({ countedBalance: 100, date: futureDate, envelopeId: envelope.id }),
    });
    expect(res.status).toBe(400);
    expect((await json(res)).error?.code).toBe('VALIDATION_ERROR');
  });

  it('unknown account -> 404 NOT_FOUND', async () => {
    const { adult, envelope } = await setup();
    const today = localToday();
    const res = await app.request('/api/v1/feoh/accounts/00000000-0000-0000-0000-000000000000/reconcile', {
      method: 'POST',
      headers: { ...authHeaders(adult.jwt), 'Content-Type': 'application/json' },
      body: JSON.stringify({ countedBalance: 100, date: today, envelopeId: envelope.id }),
    });
    expect(res.status).toBe(404);
    expect((await json(res)).error?.code).toBe('NOT_FOUND');
  });
});

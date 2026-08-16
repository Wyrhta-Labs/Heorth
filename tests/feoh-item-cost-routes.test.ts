// REST surface for the Task 10 item-cost linking (src/modules/feoh/item-costs.ts).
import { describe, it, expect } from 'vitest';
import { seedTestHousehold, authHeaders } from './helpers.js';
import * as service from '../src/modules/feoh/service.js';
import * as inventoryService from '../src/modules/inventory/service.js';
import { createApp } from '../src/app.js';
import { ALL_MODULES } from '../src/modules/index.js';

const app = createApp(ALL_MODULES);

interface JsonBody { data?: unknown; error?: { code: string; message: string } }
async function json(res: Response): Promise<JsonBody> {
  return (await res.json()) as JsonBody;
}

async function setup() {
  const { adult, child } = await seedTestHousehold();
  const account = await service.createAccount({ name: 'Checking', kind: 'asset', openingBalance: 0 });
  const envelope = await service.createEnvelope({ name: 'Household', monthlyBudget: 400 });
  return { adult, child, account, envelope };
}

async function expenseTx(adultId: string, envelopeId: string, accountId: string, amount: number, payee = 'Expense') {
  const result = await service.recordTransaction({
    date: '2026-08-01', payee, amount, memo: null,
    postings: [
      { envelopeId, accountId: null, debit: amount, credit: 0 },
      { accountId, envelopeId: null, debit: 0, credit: amount },
    ],
    splits: [],
  }, adultId);
  return result.transaction;
}

async function transferTx(adultId: string, accountId: string, account2Id: string, amount: number) {
  const result = await service.recordTransaction({
    date: '2026-08-01', payee: 'Transfer', amount, memo: null,
    postings: [
      { accountId, envelopeId: null, debit: amount, credit: 0 },
      { accountId: account2Id, envelopeId: null, debit: 0, credit: amount },
    ],
    splits: [],
  }, adultId);
  return result.transaction;
}

describe('feoh item-cost routes', () => {
  it('GET returns the TCO breakdown, 404 for an unknown item', async () => {
    const { adult, account, envelope } = await setup();
    const item = await inventoryService.createItem({ name: 'Laptop', purchasePrice: 500 });
    const txn = await expenseTx(adult.user.id, envelope.id, account.id, 100, 'Repair');

    const postRes = await app.request('/api/v1/feoh/item-costs', {
      method: 'POST', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ transactionId: txn.id, itemId: item.id, kind: 'repair' }),
    });
    expect(postRes.status).toBe(201);

    const getRes = await app.request(`/api/v1/feoh/item-costs/${item.id}`, { headers: authHeaders(adult.jwt) });
    expect(getRes.status).toBe(200);
    const body = await json(getRes) as { data: { totals: { tier2: number; total: number } } };
    expect(body.data.totals.tier2).toBe(100);
    expect(body.data.totals.total).toBe(600);

    const missingRes = await app.request('/api/v1/feoh/item-costs/00000000-0000-0000-0000-000000000000', { headers: authHeaders(adult.jwt) });
    expect(missingRes.status).toBe(404);
    expect((await json(missingRes)).error?.code).toBe('NOT_FOUND');
  });

  it('POST rejects a duplicate link with 409 DUPLICATE_LINK', async () => {
    const { adult, account, envelope } = await setup();
    const item = await inventoryService.createItem({ name: 'Drone' });
    const txn = await expenseTx(adult.user.id, envelope.id, account.id, 100);
    const first = await app.request('/api/v1/feoh/item-costs', {
      method: 'POST', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ transactionId: txn.id, itemId: item.id, kind: 'repair' }),
    });
    expect(first.status).toBe(201);

    const dupe = await app.request('/api/v1/feoh/item-costs', {
      method: 'POST', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ transactionId: txn.id, itemId: item.id, kind: 'maintenance' }),
    });
    expect(dupe.status).toBe(409);
    expect((await json(dupe)).error?.code).toBe('DUPLICATE_LINK');
  });

  it('POST rejects a transfer as a tier-2 cost with 400 NOT_A_COST', async () => {
    const { adult, account, envelope } = await setup();
    const account2 = await service.createAccount({ name: 'Savings', kind: 'asset', openingBalance: 0 });
    void envelope;
    const item = await inventoryService.createItem({ name: 'Camera' });
    const transfer = await transferTx(adult.user.id, account.id, account2.id, 300);

    const res = await app.request('/api/v1/feoh/item-costs', {
      method: 'POST', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ transactionId: transfer.id, itemId: item.id, kind: 'repair' }),
    });
    expect(res.status).toBe(400);
    expect((await json(res)).error?.code).toBe('NOT_A_COST');
  });

  it('POST rejects a repair link on a decommissioned item with 409 ITEM_DECOMMISSIONED', async () => {
    const { adult, account, envelope } = await setup();
    const item = await inventoryService.createItem({ name: 'Mower' });
    await inventoryService.decommissionItem(item.id, { date: '2026-08-01', reason: 'sold', proceeds: 50 });
    const txn = await expenseTx(adult.user.id, envelope.id, account.id, 30);

    const res = await app.request('/api/v1/feoh/item-costs', {
      method: 'POST', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ transactionId: txn.id, itemId: item.id, kind: 'repair' }),
    });
    expect(res.status).toBe(409);
    expect((await json(res)).error?.code).toBe('ITEM_DECOMMISSIONED');
  });

  it('DELETE removes a link (200) and 404s for an unknown id', async () => {
    const { adult, account, envelope } = await setup();
    const item = await inventoryService.createItem({ name: 'Blender' });
    const txn = await expenseTx(adult.user.id, envelope.id, account.id, 15);
    const postRes = await app.request('/api/v1/feoh/item-costs', {
      method: 'POST', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ transactionId: txn.id, itemId: item.id, kind: 'repair' }),
    });
    const created = (await json(postRes)).data as { id: string };

    const delRes = await app.request(`/api/v1/feoh/item-costs/${created.id}`, {
      method: 'DELETE', headers: authHeaders(adult.jwt),
    });
    expect(delRes.status).toBe(200);
    expect((await json(delRes)).data).toEqual({ id: created.id });

    const missingDelRes = await app.request(`/api/v1/feoh/item-costs/${created.id}`, {
      method: 'DELETE', headers: authHeaders(adult.jwt),
    });
    expect(missingDelRes.status).toBe(404);
  });

  it('rejects POST/DELETE for a child role with 403', async () => {
    const { adult, child, account, envelope } = await setup();
    const item = await inventoryService.createItem({ name: 'Toaster' });
    const txn = await expenseTx(adult.user.id, envelope.id, account.id, 15);

    const postRes = await app.request('/api/v1/feoh/item-costs', {
      method: 'POST', headers: authHeaders(child.jwt),
      body: JSON.stringify({ transactionId: txn.id, itemId: item.id, kind: 'repair' }),
    });
    expect(postRes.status).toBe(403);

    const delRes = await app.request('/api/v1/feoh/item-costs/00000000-0000-0000-0000-000000000000', {
      method: 'DELETE', headers: authHeaders(child.jwt),
    });
    expect(delRes.status).toBe(403);
  });
});

import { describe, it, expect } from 'vitest';
import { seedTestHousehold, authHeaders } from './helpers.js';
import { createApp } from '../src/app.js';
import { ALL_MODULES } from '../src/modules/index.js';

// Finance is a built-in module (ADR 0007), always on, rather than a satellite proxy.
const app = createApp(ALL_MODULES);

describe('integration smoke (all modules, one app)', () => {
  it('an adult can move through calendar, meals and feoh; a child is blocked from finance writes', async () => {
    const { adult, child } = await seedTestHousehold();

    // Calendar: create an event.
    const ev = await app.request('/api/v1/events', {
      method: 'POST', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ title: 'Shop', startAt: '2026-07-05T09:00:00Z', endAt: '2026-07-05T10:00:00Z' }),
    });
    expect(ev.status).toBe(201);

    // Meals: create a recipe.
    const recipe = await app.request('/api/v1/recipes', {
      method: 'POST', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ title: 'Pottage', servings: 4, ingredients: [{ name: 'Lentils', qty: 200, unit: 'g' }], steps: ['Simmer'], tags: ['veg'] }),
    });
    expect(recipe.status).toBe(201);

    // Feoh: adult records a balanced transaction.
    const envRes = await app.request('/api/v1/feoh/envelopes', {
      method: 'POST', headers: authHeaders(adult.jwt), body: JSON.stringify({ name: 'Groceries', monthlyBudget: 400 }),
    });
    const { data: envelope } = await envRes.json() as { data: { id: string } };
    const acctRes = await app.request('/api/v1/feoh/accounts', {
      method: 'POST', headers: authHeaders(adult.jwt), body: JSON.stringify({ name: 'Checking', kind: 'asset', openingBalance: 0 }),
    });
    const { data: account } = await acctRes.json() as { data: { id: string } };
    const txn = await app.request('/api/v1/feoh/transactions', {
      method: 'POST', headers: authHeaders(adult.jwt),
      body: JSON.stringify({
        date: '2026-07-05', payee: 'Market', amount: 50,
        postings: [{ envelopeId: envelope.id, debit: 50, credit: 0 }, { accountId: account.id, debit: 0, credit: 50 }],
      }),
    });
    expect(txn.status).toBe(201);

    // Child is blocked from finance writes but can read the summary.
    const childWrite = await app.request('/api/v1/feoh/transactions', {
      method: 'POST', headers: authHeaders(child.jwt),
      body: JSON.stringify({
        date: '2026-07-05', payee: 'Sweets', amount: 5,
        postings: [{ envelopeId: envelope.id, debit: 5, credit: 0 }, { accountId: account.id, debit: 0, credit: 5 }],
      }),
    });
    expect(childWrite.status).toBe(403);

    const summary = await app.request('/api/v1/feoh/summary?month=2026-07', { headers: authHeaders(child.jwt) });
    expect(summary.status).toBe(200);
    const { data } = await summary.json() as { data: { totals: { spent: number } } };
    expect(data.totals.spent).toBe(50);
  });
});

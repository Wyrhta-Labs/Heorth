// tests/feoh-accounts.test.ts
import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app.js';
import { householdModule } from '../src/household/index.js';
import { feohModule } from '../src/modules/feoh/index.js';
import { seedTestHousehold, authHeaders } from './helpers.js';

const app = createApp([householdModule, feohModule]);

describe('feoh accounts & envelopes', () => {
  it('adult can create an envelope; child cannot', async () => {
    const { adult, child } = await seedTestHousehold();
    const ok = await app.request('/api/v1/feoh/envelopes', {
      method: 'POST', headers: authHeaders(adult.jwt), body: JSON.stringify({ name: 'Groceries', monthlyBudget: 400 }),
    });
    expect(ok.status).toBe(201);

    const forbidden = await app.request('/api/v1/feoh/envelopes', {
      method: 'POST', headers: authHeaders(child.jwt), body: JSON.stringify({ name: 'Sweets', monthlyBudget: 20 }),
    });
    expect(forbidden.status).toBe(403);
  });

  it('a child can still read envelopes', async () => {
    const { adult, child } = await seedTestHousehold();
    await app.request('/api/v1/feoh/envelopes', {
      method: 'POST', headers: authHeaders(adult.jwt), body: JSON.stringify({ name: 'Groceries', monthlyBudget: 400 }),
    });
    const res = await app.request('/api/v1/feoh/envelopes', { headers: authHeaders(child.jwt) });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(body.data.length).toBe(1);
  });

  it('adult can create, read, update and delete an account', async () => {
    const { adult } = await seedTestHousehold();
    const created = await app.request('/api/v1/feoh/accounts', {
      method: 'POST', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ name: 'Checking', kind: 'asset', openingBalance: 1000 }),
    });
    expect(created.status).toBe(201);
    const { data: acct } = await created.json() as { data: { id: string; name: string; kind: string } };
    expect(acct.name).toBe('Checking');
    expect(acct.kind).toBe('asset');

    const list = await app.request('/api/v1/feoh/accounts', { headers: authHeaders(adult.jwt) });
    expect(list.status).toBe(200);
    expect(((await list.json()) as { data: unknown[] }).data.length).toBe(1);

    const patched = await app.request(`/api/v1/feoh/accounts/${acct.id}`, {
      method: 'PATCH', headers: authHeaders(adult.jwt), body: JSON.stringify({ name: 'Everyday Checking' }),
    });
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as { data: { name: string } }).data.name).toBe('Everyday Checking');

    const deleted = await app.request(`/api/v1/feoh/accounts/${acct.id}`, {
      method: 'DELETE', headers: authHeaders(adult.jwt),
    });
    expect(deleted.status).toBe(200);
    expect(((await deleted.json()) as { data: { id: string } }).data.id).toBe(acct.id);

    const listAfter = await app.request('/api/v1/feoh/accounts', { headers: authHeaders(adult.jwt) });
    expect(((await listAfter.json()) as { data: unknown[] }).data.length).toBe(0);
  });

  it('returns 404 when updating or deleting an unknown account', async () => {
    const { adult } = await seedTestHousehold();
    const missingId = '00000000-0000-0000-0000-000000000000';
    const patch = await app.request(`/api/v1/feoh/accounts/${missingId}`, {
      method: 'PATCH', headers: authHeaders(adult.jwt), body: JSON.stringify({ name: 'Nope' }),
    });
    expect(patch.status).toBe(404);
    const del = await app.request(`/api/v1/feoh/accounts/${missingId}`, {
      method: 'DELETE', headers: authHeaders(adult.jwt),
    });
    expect(del.status).toBe(404);
  });

  it('a child cannot create, update or delete an account', async () => {
    const { adult, child } = await seedTestHousehold();
    const { data: acct } = await (await app.request('/api/v1/feoh/accounts', {
      method: 'POST', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ name: 'Savings', kind: 'asset', openingBalance: 0 }),
    })).json() as { data: { id: string } };

    const create = await app.request('/api/v1/feoh/accounts', {
      method: 'POST', headers: authHeaders(child.jwt),
      body: JSON.stringify({ name: 'Piggy Bank', kind: 'asset', openingBalance: 0 }),
    });
    expect(create.status).toBe(403);

    const patch = await app.request(`/api/v1/feoh/accounts/${acct.id}`, {
      method: 'PATCH', headers: authHeaders(child.jwt), body: JSON.stringify({ name: 'Mine' }),
    });
    expect(patch.status).toBe(403);

    const del = await app.request(`/api/v1/feoh/accounts/${acct.id}`, {
      method: 'DELETE', headers: authHeaders(child.jwt),
    });
    expect(del.status).toBe(403);
  });
});

import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app.js';
import { householdModule } from '../src/household/index.js';
import { feohModule } from '../src/modules/feoh/index.js';
import { seedTestHousehold, authHeaders } from './helpers.js';
import * as service from '../src/modules/feoh/service.js';

const app = createApp([householdModule, feohModule]);

describe('feoh recurring bills', () => {
  it('creates and lists a recurring bill', async () => {
    await seedTestHousehold();
    const envelope = await service.createEnvelope({ name: 'Utilities', monthlyBudget: 200 });
    await service.createBill({ payee: 'Power Co', amount: 85, cadence: 'P1M', nextDue: '2026-08-01', envelopeId: envelope.id });
    const bills = await service.listBills();
    expect(bills.length).toBe(1);
    expect(bills[0]!.payee).toBe('Power Co');
    expect(bills[0]!.cadence).toBe('P1M');
  });

  it('adult can update and delete a bill via the API', async () => {
    const { adult } = await seedTestHousehold();
    const { data: bill } = await (await app.request('/api/v1/feoh/bills', {
      method: 'POST', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ payee: 'Water Co', amount: 40, cadence: 'P1M', nextDue: '2026-08-15' }),
    })).json() as { data: { id: string } };

    const patched = await app.request(`/api/v1/feoh/bills/${bill.id}`, {
      method: 'PATCH', headers: authHeaders(adult.jwt), body: JSON.stringify({ amount: 45, payee: 'City Water' }),
    });
    expect(patched.status).toBe(200);
    const patchedBody = await patched.json() as { data: { payee: string; amount: string } };
    expect(patchedBody.data.payee).toBe('City Water');
    expect(patchedBody.data.amount).toBe('45.00');

    const deleted = await app.request(`/api/v1/feoh/bills/${bill.id}`, {
      method: 'DELETE', headers: authHeaders(adult.jwt),
    });
    expect(deleted.status).toBe(200);
    const list = await app.request('/api/v1/feoh/bills', { headers: authHeaders(adult.jwt) });
    expect(((await list.json()) as { data: unknown[] }).data.length).toBe(0);
  });

  it('returns 404 when updating or deleting an unknown bill', async () => {
    const { adult } = await seedTestHousehold();
    const missingId = '00000000-0000-0000-0000-000000000000';
    const patch = await app.request(`/api/v1/feoh/bills/${missingId}`, {
      method: 'PATCH', headers: authHeaders(adult.jwt), body: JSON.stringify({ amount: 10 }),
    });
    expect(patch.status).toBe(404);
    const del = await app.request(`/api/v1/feoh/bills/${missingId}`, {
      method: 'DELETE', headers: authHeaders(adult.jwt),
    });
    expect(del.status).toBe(404);
  });

  it('a child cannot create, update or delete a bill', async () => {
    const { adult, child } = await seedTestHousehold();
    const { data: bill } = await (await app.request('/api/v1/feoh/bills', {
      method: 'POST', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ payee: 'Gas Co', amount: 60, cadence: 'P1M', nextDue: '2026-08-20' }),
    })).json() as { data: { id: string } };

    const create = await app.request('/api/v1/feoh/bills', {
      method: 'POST', headers: authHeaders(child.jwt),
      body: JSON.stringify({ payee: 'Allowance', amount: 5, cadence: 'P1W', nextDue: '2026-08-01' }),
    });
    expect(create.status).toBe(403);

    const patch = await app.request(`/api/v1/feoh/bills/${bill.id}`, {
      method: 'PATCH', headers: authHeaders(child.jwt), body: JSON.stringify({ amount: 1 }),
    });
    expect(patch.status).toBe(403);

    const del = await app.request(`/api/v1/feoh/bills/${bill.id}`, {
      method: 'DELETE', headers: authHeaders(child.jwt),
    });
    expect(del.status).toBe(403);
  });
});

// Ported from Feoh's tests/feoh-bills.test.ts, adapted to Heorth's
// household-member auth (seedTestHousehold/authHeaders) in place of Feoh's
// single-user adminJwt. FEOH_ENABLED is set before the dynamic import of
// src/app.js so config.feohEnabled is true when the module registers —
// mirrors the M365 suite's env-gated-config precedent (see integration-smoke.test.ts).
import { describe, it, expect, afterAll, vi } from 'vitest';
import { seedTestHousehold, authHeaders } from './helpers.js';
import * as service from '../src/modules/feoh/service.js';

process.env['FEOH_ENABLED'] = 'true';
// helpers.js's own static import chain already loaded src/config/env.js (with
// FEOH_ENABLED unset) before the assignment above ran — vi.resetModules()
// forces the dynamic imports below to re-evaluate it against the current env.
vi.resetModules();
const { createApp } = await import('../src/app.js');
const { ALL_MODULES } = await import('../src/modules/index.js');

const app = createApp(ALL_MODULES);

// singleFork shares process.env across test files — restore the ambient
// default (unset/disabled) so later files aren't affected by this one.
afterAll(() => { delete process.env['FEOH_ENABLED']; });

describe('feoh recurring bills', () => {
  it('creates and lists a recurring bill', async () => {
    const envelope = await service.createEnvelope({ name: 'Utilities', monthlyBudget: 200 });
    await service.createBill({ payee: 'Power Co', amount: 85, cadence: 'P1M', nextDue: '2026-08-01', envelopeId: envelope.id });
    const bills = await service.listBills();
    expect(bills.length).toBe(1);
    expect(bills[0]!.payee).toBe('Power Co');
    expect(bills[0]!.cadence).toBe('P1M');
  });

  it('updates and deletes a bill via the API', async () => {
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
});

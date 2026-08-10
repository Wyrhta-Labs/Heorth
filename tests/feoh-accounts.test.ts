// Ported from Feoh's tests/feoh-accounts.test.ts, adapted to Heorth's
// household-member auth (seedTestHousehold/authHeaders) in place of Feoh's
// single-user adminJwt. FEOH_ENABLED is set before the dynamic import of
// src/app.js so config.feohEnabled is true when the module registers —
// mirrors the M365 suite's env-gated-config precedent (see integration-smoke.test.ts).
import { describe, it, expect, afterAll, vi } from 'vitest';
import { seedTestHousehold, authHeaders } from './helpers.js';

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

describe('feoh accounts & envelopes', () => {
  it('creates and lists an envelope', async () => {
    const { adult } = await seedTestHousehold();
    const created = await app.request('/api/v1/feoh/envelopes', {
      method: 'POST', headers: authHeaders(adult.jwt), body: JSON.stringify({ name: 'Groceries', monthlyBudget: 400 }),
    });
    expect(created.status).toBe(201);

    const res = await app.request('/api/v1/feoh/envelopes', { headers: authHeaders(adult.jwt) });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(body.data.length).toBe(1);
  });

  it('rejects an unauthenticated request to read envelopes', async () => {
    const res = await app.request('/api/v1/feoh/envelopes');
    expect(res.status).toBe(401);
  });

  it('creates, reads, updates and deletes an account', async () => {
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
});

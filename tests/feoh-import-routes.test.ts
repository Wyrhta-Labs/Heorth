import { describe, it, expect, afterEach } from 'vitest';
import { seedTestHousehold, authHeaders } from './helpers.js';
import * as feoh from '../src/modules/feoh/service.js';
import { createApp } from '../src/app.js';
import { ALL_MODULES } from '../src/modules/index.js';
import { setTransactionSourceProvider, resetTransactionSourceProvider } from '../src/modules/feoh/import/provider.js';
import { FakeSource, fakeLine } from './fake-source.js';

const app = createApp(ALL_MODULES);
const BASE = '/api/v1/feoh/ingestion';

interface Body<T = unknown> { data?: T; meta?: Record<string, unknown>; error?: { code: string; message: string } }
async function json<T = unknown>(res: Response): Promise<Body<T>> { return (await res.json()) as Body<T>; }

afterEach(() => resetTransactionSourceProvider());

async function setup() {
  const { adult, child, admin } = await seedTestHousehold();
  const account = await feoh.createAccount({ name: 'Joint', kind: 'asset', openingBalance: 0 });
  const groceries = await feoh.createEnvelope({ name: 'Groceries', monthlyBudget: 400 });
  return { adult, child, admin, account, groceries };
}

describe('ingestion routes — gates', () => {
  it('requires auth on reads and adult/admin on writes', async () => {
    const { child } = await setup();
    expect((await app.request(`${BASE}/status`)).status).toBe(401);
    expect((await app.request(`${BASE}/status`, { headers: authHeaders(child.jwt) })).status).toBe(200);
    expect((await app.request(`${BASE}/sync`, { method: 'POST', headers: authHeaders(child.jwt) })).status).toBe(403);
    expect((await app.request(`${BASE}/rules`, { method: 'POST', headers: authHeaders(child.jwt), body: '{}' })).status).toBe(403);
  });

  it('refuses the maintenance admin on writes (finance quarantine)', async () => {
    const { admin, groceries } = await setup();
    const res = await app.request(`${BASE}/rules`, {
      method: 'POST', headers: authHeaders(admin.jwt), body: JSON.stringify({ pattern: 'x', envelopeId: groceries.id }),
    });
    expect(res.status).toBe(403);
  });
});

describe('ingestion routes — sync and status', () => {
  it('sync answers 409 PROVIDER_UNAVAILABLE when import is disabled', async () => {
    const { adult } = await setup();
    const res = await app.request(`${BASE}/sync`, { method: 'POST', headers: authHeaders(adult.jwt) });
    expect(res.status).toBe(409);
    expect((await json(res)).error!.code).toBe('PROVIDER_UNAVAILABLE');
  });

  it('sync runs a tick with the installed provider and status reflects it', async () => {
    const { adult } = await setup();
    const fake = new FakeSource();
    fake.rows = [fakeLine({ sourceId: '1:1' })];
    setTransactionSourceProvider(fake);
    const res = await app.request(`${BASE}/sync`, { method: 'POST', headers: authHeaders(adult.jwt) });
    expect(res.status).toBe(200);
    expect((await json<{ inserted: number }>(res)).data!.inserted).toBe(1);
    const status = await json<{ enabled: boolean; pendingCount: number }>(await app.request(`${BASE}/status`, { headers: authHeaders(adult.jwt) }));
    expect(status.data).toMatchObject({ enabled: true, pendingCount: 1 });
  });

  it('a failed tick is a 502 with the classified token as code', async () => {
    const { adult } = await setup();
    const fake = new FakeSource();
    const { SourceProviderError } = await import('../src/modules/feoh/import/providers/types.js');
    fake.failWith = new SourceProviderError('auth_failed');
    setTransactionSourceProvider(fake);
    const res = await app.request(`${BASE}/sync`, { method: 'POST', headers: authHeaders(adult.jwt) });
    expect(res.status).toBe(502);
    expect((await json(res)).error!.code).toBe('AUTH_FAILED');
  });
});

describe('ingestion routes — mappings and rules', () => {
  it('PUT /accounts upserts by source account and rejects an unknown Feoh account', async () => {
    const { adult, account } = await setup();
    const put = (accountId: string) => app.request(`${BASE}/accounts`, {
      method: 'PUT', headers: authHeaders(adult.jwt), body: JSON.stringify({ sourceAccountId: '7', accountId }),
    });
    expect((await put(account.id)).status).toBe(200);
    expect((await put(account.id)).status).toBe(200);
    const list = await json<unknown[]>(await app.request(`${BASE}/accounts`, { headers: authHeaders(adult.jwt) }));
    expect(list.data).toHaveLength(1);
    const bad = await put('00000000-0000-0000-0000-000000000000');
    expect(bad.status).toBe(400);
    expect((await json(bad)).error!.code).toBe('INVALID_REFERENCE');
  });

  it('rules: create 201, patch, list in (priority, id) order, delete; unknown envelope is 400', async () => {
    const { adult, groceries } = await setup();
    const create = (body: Record<string, unknown>) => app.request(`${BASE}/rules`, {
      method: 'POST', headers: authHeaders(adult.jwt), body: JSON.stringify(body),
    });
    const r1 = await json<{ id: string }>(await create({ pattern: 'rewe', envelopeId: groceries.id, priority: 5 }));
    const r2res = await create({ pattern: 'aldi', envelopeId: groceries.id, priority: 1 });
    expect(r2res.status).toBe(201);
    const r2 = await json<{ id: string }>(r2res);
    const list = await json<{ id: string }[]>(await app.request(`${BASE}/rules`, { headers: authHeaders(adult.jwt) }));
    expect(list.data!.map((r) => r.id)).toEqual([r2.data!.id, r1.data!.id]);
    const patched = await app.request(`${BASE}/rules/${r1.data!.id}`, {
      method: 'PATCH', headers: authHeaders(adult.jwt), body: JSON.stringify({ enabled: false }),
    });
    expect(patched.status).toBe(200);
    expect((await json<{ enabled: boolean }>(patched)).data!.enabled).toBe(false);
    expect((await create({ pattern: 'x', envelopeId: '00000000-0000-0000-0000-000000000000' })).status).toBe(400);
    expect((await create({ pattern: '', envelopeId: groceries.id })).status).toBe(400);
    const del = await app.request(`${BASE}/rules/${r2.data!.id}`, { method: 'DELETE', headers: authHeaders(adult.jwt) });
    expect(del.status).toBe(200);
    expect((await app.request(`${BASE}/rules/${r2.data!.id}`, { method: 'DELETE', headers: authHeaders(adult.jwt) })).status).toBe(404);
  });

  it('deleting an envelope a rule points at answers 409 ENVELOPE_IN_USE', async () => {
    const { adult, groceries } = await setup();
    await app.request(`${BASE}/rules`, { method: 'POST', headers: authHeaders(adult.jwt), body: JSON.stringify({ pattern: 'rewe', envelopeId: groceries.id }) });
    const res = await app.request(`/api/v1/feoh/envelopes/${groceries.id}`, { method: 'DELETE', headers: authHeaders(adult.jwt) });
    expect(res.status).toBe(409);
    expect((await json(res)).error!.code).toBe('ENVELOPE_IN_USE');
  });
});

describe('ingestion routes — inbox', () => {
  it('manual line: 201 on create, 200 on repeat, then confirm and dismiss with their conflicts', async () => {
    const { adult, account, groceries } = await setup();
    const line = { sourceId: 'demo-7', sourceAccountId: 'cash', date: '2026-09-03', payee: 'Kiosk', amount: 2.5, direction: 'out' };
    const first = await app.request(`${BASE}/inbox`, { method: 'POST', headers: authHeaders(adult.jwt), body: JSON.stringify(line) });
    expect(first.status).toBe(201);
    const row = (await json<{ id: string; status: string }>(first)).data!;
    expect(row.status).toBe('pending');
    const again = await app.request(`${BASE}/inbox`, { method: 'POST', headers: authHeaders(adult.jwt), body: JSON.stringify(line) });
    expect(again.status).toBe(200);

    const listed = await json<{ id: string }[]>(await app.request(`${BASE}/inbox?status=pending`, { headers: authHeaders(adult.jwt) }));
    expect(listed.data).toHaveLength(1);
    expect(listed.meta).toMatchObject({ total: 1 });

    // unmapped source account without an explicit accountId
    const unmapped = await app.request(`${BASE}/inbox/${row.id}/confirm`, {
      method: 'POST', headers: authHeaders(adult.jwt), body: JSON.stringify({ envelopeId: groceries.id }),
    });
    expect(unmapped.status).toBe(409);
    expect((await json(unmapped)).error!.code).toBe('ACCOUNT_UNMAPPED');

    const booked = await app.request(`${BASE}/inbox/${row.id}/confirm`, {
      method: 'POST', headers: authHeaders(adult.jwt), body: JSON.stringify({ envelopeId: groceries.id, accountId: account.id }),
    });
    expect(booked.status).toBe(200);
    expect((await json<{ status: string }>(booked)).data!.status).toBe('booked');

    const dismiss = await app.request(`${BASE}/inbox/${row.id}/dismiss`, { method: 'POST', headers: authHeaders(adult.jwt) });
    expect(dismiss.status).toBe(409);
    expect((await json(dismiss)).error!.code).toBe('NOT_PENDING');
    expect((await app.request(`${BASE}/inbox/00000000-0000-0000-0000-000000000000/dismiss`, { method: 'POST', headers: authHeaders(adult.jwt) })).status).toBe(404);
  });

  it('a foreign-currency line cannot be confirmed', async () => {
    const { adult, account, groceries } = await setup();
    const res = await app.request(`${BASE}/inbox`, {
      method: 'POST', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ sourceAccountId: 'cash', date: '2026-09-03', payee: 'Ebook', amount: 12, direction: 'out', currency: 'USD' }),
    });
    const row = (await json<{ id: string }>(res)).data!;
    const confirm = await app.request(`${BASE}/inbox/${row.id}/confirm`, {
      method: 'POST', headers: authHeaders(adult.jwt), body: JSON.stringify({ envelopeId: groceries.id, accountId: account.id }),
    });
    expect(confirm.status).toBe(409);
    expect((await json(confirm)).error!.code).toBe('CURRENCY_MISMATCH');
  });
});

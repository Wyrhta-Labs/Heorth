// The FEOH_ENABLED kill switch (ADR 0007). `src/config/env.ts` reads process.env
// once, at module-load time — Vitest gives each test FILE a fresh module graph
// (default `isolate: true`), but within THIS file we need BOTH the disabled and
// the enabled state, so state changes go through `vi.resetModules()` + a fresh
// dynamic `import()` of src/app.js / src/modules/index.js after mutating
// process.env.FEOH_ENABLED. This mirrors the M365 suite's env-gated-config
// precedent (tests/m365-routes.test.ts builds a bare app to force "enabled"
// behavior regardless of the ambient config); here the toggle itself is under
// test, so the config singleton is deliberately re-created for each state.
// The database is real Postgres throughout — re-importing src/db/index.js just
// opens another connection to the same already-migrated database, so data
// written under one config instance is visible under the next.
import { describe, it, expect, vi, afterAll } from 'vitest';
import { seedTestHousehold, authHeaders } from './helpers.js';

// singleFork shares process.env across test files — restore the ambient
// default (unset/disabled) so later files aren't affected by this one.
afterAll(() => { delete process.env['FEOH_ENABLED']; });

async function freshApp() {
  vi.resetModules();
  const { createApp } = await import('../src/app.js');
  const { ALL_MODULES } = await import('../src/modules/index.js');
  return createApp(ALL_MODULES);
}

async function freshMcpTools() {
  vi.resetModules();
  const { collectMcpTools } = await import('../src/app.js');
  const { ALL_MODULES } = await import('../src/modules/index.js');
  return collectMcpTools(ALL_MODULES).all();
}

describe('feoh module gating (FEOH_ENABLED kill switch, ADR 0007)', () => {
  describe('disabled (default test env)', () => {
    it('every /api/v1/feoh/* route 404s via the catch-all envelope', async () => {
      delete process.env['FEOH_ENABLED'];
      const app = await freshApp();
      const { adult } = await seedTestHousehold();

      const get = await app.request('/api/v1/feoh/accounts', { headers: authHeaders(adult.jwt) });
      expect(get.status).toBe(404);
      const body = await get.json() as { error: { code: string } };
      expect(body.error.code).toBe('NOT_FOUND');

      const post = await app.request('/api/v1/feoh/transactions', {
        method: 'POST', headers: authHeaders(adult.jwt), body: JSON.stringify({}),
      });
      expect(post.status).toBe(404);
    });

    it('GET /api/v1/features reports finance disabled', async () => {
      delete process.env['FEOH_ENABLED'];
      const app = await freshApp();
      const { adult } = await seedTestHousehold();
      const res = await app.request('/api/v1/features', { headers: authHeaders(adult.jwt) });
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { finance: boolean } };
      expect(body.data.finance).toBe(false);
    });

    it('the MCP registry contains no feoh.* tools', async () => {
      delete process.env['FEOH_ENABLED'];
      const tools = await freshMcpTools();
      expect(tools.some((t) => t.name.startsWith('feoh.'))).toBe(false);
    });
  });

  describe('enabled', () => {
    it('routes respond', async () => {
      process.env['FEOH_ENABLED'] = 'true';
      const app = await freshApp();
      const { adult } = await seedTestHousehold();
      const res = await app.request('/api/v1/feoh/accounts', { headers: authHeaders(adult.jwt) });
      expect(res.status).toBe(200);
    });

    it('GET /api/v1/features reports finance enabled', async () => {
      process.env['FEOH_ENABLED'] = 'true';
      const app = await freshApp();
      const { adult } = await seedTestHousehold();
      const res = await app.request('/api/v1/features', { headers: authHeaders(adult.jwt) });
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { finance: boolean } };
      expect(body.data.finance).toBe(true);
    });
  });

  describe('authorization (enabled)', () => {
    it('a child gets 403 on POST /api/v1/feoh/accounts', async () => {
      process.env['FEOH_ENABLED'] = 'true';
      const app = await freshApp();
      const { child } = await seedTestHousehold();
      const res = await app.request('/api/v1/feoh/accounts', {
        method: 'POST', headers: authHeaders(child.jwt),
        body: JSON.stringify({ name: 'Checking', kind: 'asset', openingBalance: 0 }),
      });
      expect(res.status).toBe(403);
    });

    it('a child gets 403 on POST /api/v1/feoh/envelopes', async () => {
      process.env['FEOH_ENABLED'] = 'true';
      const app = await freshApp();
      const { child } = await seedTestHousehold();
      const res = await app.request('/api/v1/feoh/envelopes', {
        method: 'POST', headers: authHeaders(child.jwt),
        body: JSON.stringify({ name: 'Groceries', monthlyBudget: 400 }),
      });
      expect(res.status).toBe(403);
    });

    it('the maintenance admin is rejected on a finance write per the quarantine error contract', async () => {
      process.env['FEOH_ENABLED'] = 'true';
      const app = await freshApp();
      // seedTestHousehold's `admin` has handle 'admin' — the maintenance-admin anchor.
      const { admin } = await seedTestHousehold();
      const res = await app.request('/api/v1/feoh/accounts', {
        method: 'POST', headers: authHeaders(admin.jwt),
        body: JSON.stringify({ name: 'Checking', kind: 'asset', openingBalance: 0 }),
      });
      expect(res.status).toBe(403);
      const body = await res.json() as { error: { code: string } };
      expect(body.error.code).toBe('ADMIN_NOT_A_MEMBER');
    });
  });

  describe('toggle round-trip', () => {
    it('data written while enabled survives a disable/enable cycle (toggle never touches data)', async () => {
      // 1. Enabled: create an account and a balanced transaction.
      process.env['FEOH_ENABLED'] = 'true';
      let app = await freshApp();
      const { adult } = await seedTestHousehold();

      const envRes = await app.request('/api/v1/feoh/envelopes', {
        method: 'POST', headers: authHeaders(adult.jwt),
        body: JSON.stringify({ name: 'Groceries', monthlyBudget: 400 }),
      });
      expect(envRes.status).toBe(201);
      const { data: envelope } = await envRes.json() as { data: { id: string } };

      const acctRes = await app.request('/api/v1/feoh/accounts', {
        method: 'POST', headers: authHeaders(adult.jwt),
        body: JSON.stringify({ name: 'Checking', kind: 'asset', openingBalance: 0 }),
      });
      expect(acctRes.status).toBe(201);
      const { data: account } = await acctRes.json() as { data: { id: string } };

      const txnRes = await app.request('/api/v1/feoh/transactions', {
        method: 'POST', headers: authHeaders(adult.jwt),
        body: JSON.stringify({
          date: '2026-07-05', payee: 'Market', amount: 50,
          postings: [{ envelopeId: envelope.id, debit: 50, credit: 0 }, { accountId: account.id, debit: 0, credit: 50 }],
        }),
      });
      expect(txnRes.status).toBe(201);

      // 2. Disabled: routes 404 — the module never touches the rows it just wrote.
      process.env['FEOH_ENABLED'] = 'false';
      app = await freshApp();
      const disabledRes = await app.request('/api/v1/feoh/accounts', { headers: authHeaders(adult.jwt) });
      expect(disabledRes.status).toBe(404);

      // 3. Re-enabled: the account and transaction are still there, untouched.
      process.env['FEOH_ENABLED'] = 'true';
      app = await freshApp();
      const accountsAfter = await app.request('/api/v1/feoh/accounts', { headers: authHeaders(adult.jwt) });
      expect(accountsAfter.status).toBe(200);
      const { data: accounts } = await accountsAfter.json() as { data: Array<{ id: string; name: string }> };
      expect(accounts.find((a) => a.id === account.id)?.name).toBe('Checking');

      const txnListRes = await app.request('/api/v1/feoh/transactions', { headers: authHeaders(adult.jwt) });
      const { data: txnList } = await txnListRes.json() as { data: Array<{ id: string }> };
      expect(txnList.length).toBe(1);

      const txnAfter = await app.request(`/api/v1/feoh/transactions/${txnList[0]!.id}`, { headers: authHeaders(adult.jwt) });
      expect(txnAfter.status).toBe(200);
      const { data: txn } = await txnAfter.json() as { data: { transaction: { payee: string; amount: string } } };
      expect(txn.transaction.payee).toBe('Market');
      expect(txn.transaction.amount).toBe('50.00');
    });
  });
});

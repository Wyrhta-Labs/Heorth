// Ported from Feoh's tests/feoh-summary.test.ts, adapted to Heorth's member
// semantics: the household member's id (from seedTestHousehold) stands in
// for Feoh's `createTestParty`, and `recordTransaction` takes it as the
// second (createdBy) parameter instead of the input body. This test calls
// the service directly (no HTTP routes), so it needs no FEOH_ENABLED gate.
import { describe, it, expect, vi, afterAll } from 'vitest';
import { seedTestHousehold, authHeaders } from './helpers.js';
import * as service from '../src/modules/feoh/service.js';

// singleFork shares process.env across test files — restore the ambient
// default (unset/disabled) so later files aren't affected by this one.
afterAll(() => { delete process.env['FEOH_ENABLED']; });

describe('feoh month summary', () => {
  it('aggregates spend per envelope vs budget within the month', async () => {
    const { adult } = await seedTestHousehold();
    const account = await service.createAccount({ name: 'Checking', kind: 'asset', openingBalance: 0 });
    const groceries = await service.createEnvelope({ name: 'Groceries', monthlyBudget: 400 });

    await service.recordTransaction({
      date: '2026-07-05', payee: 'Market', amount: 120, memo: null,
      postings: [{ envelopeId: groceries.id, debit: 120, credit: 0 }, { accountId: account.id, debit: 0, credit: 120 }],
      splits: [],
    }, adult.user.id);
    // Out-of-month transaction must be excluded.
    await service.recordTransaction({
      date: '2026-08-01', payee: 'Market', amount: 50, memo: null,
      postings: [{ envelopeId: groceries.id, debit: 50, credit: 0 }, { accountId: account.id, debit: 0, credit: 50 }],
      splits: [],
    }, adult.user.id);

    const summary = await service.getMonthSummary('2026-07');
    const g = summary.envelopes.find((e) => e.name === 'Groceries')!;
    expect(g.budget).toBe(400);
    expect(g.spent).toBe(120);
    expect(g.remaining).toBe(280);
    expect(summary.totals.spent).toBe(120);
  });

  it('rejects an out-of-range month (13) with a 400 VALIDATION_ERROR, not a Postgres 500', async () => {
    process.env['FEOH_ENABLED'] = 'true';
    vi.resetModules();
    const { createApp } = await import('../src/app.js');
    const { ALL_MODULES } = await import('../src/modules/index.js');
    const app = createApp(ALL_MODULES);
    const { adult } = await seedTestHousehold();

    const res = await app.request('/api/v1/feoh/summary?month=2026-13', { headers: authHeaders(adult.jwt) });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });
});

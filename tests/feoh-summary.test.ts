import { describe, it, expect } from 'vitest';
import { seedTestHousehold } from './helpers.js';
import * as service from '../src/modules/feoh/service.js';

describe('feoh month summary', () => {
  it('aggregates spend per envelope vs budget within the month', async () => {
    const { admin } = await seedTestHousehold();
    const account = await service.createAccount({ name: 'Checking', kind: 'asset', openingBalance: 0 });
    const groceries = await service.createEnvelope({ name: 'Groceries', monthlyBudget: 400 });

    await service.recordTransaction({
      date: '2026-07-05', payee: 'Market', amount: 120, memo: null,
      postings: [{ envelopeId: groceries.id, debit: 120, credit: 0 }, { accountId: account.id, debit: 0, credit: 120 }],
      splits: [],
    }, admin.user.id);
    // Out-of-month transaction must be excluded.
    await service.recordTransaction({
      date: '2026-08-01', payee: 'Market', amount: 50, memo: null,
      postings: [{ envelopeId: groceries.id, debit: 50, credit: 0 }, { accountId: account.id, debit: 0, credit: 50 }],
      splits: [],
    }, admin.user.id);

    const summary = await service.getMonthSummary('2026-07');
    const g = summary.envelopes.find((e) => e.name === 'Groceries')!;
    expect(g.budget).toBe(400);
    expect(g.spent).toBe(120);
    expect(g.remaining).toBe(280);
    expect(summary.totals.spent).toBe(120);
  });
});

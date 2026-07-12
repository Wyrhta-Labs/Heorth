import { describe, it, expect } from 'vitest';
import { seedTestHousehold, invokeTool } from './helpers.js';
import { feohTools } from '../src/modules/feoh/mcp.js';
import * as service from '../src/modules/feoh/service.js';

describe('feoh MCP tools', () => {
  it('records a balanced transaction and summarises the month', async () => {
    const { adult } = await seedTestHousehold();
    const account = await service.createAccount({ name: 'Checking', kind: 'asset', openingBalance: 0 });
    const envelope = await service.createEnvelope({ name: 'Groceries', monthlyBudget: 400 });

    await invokeTool(feohTools, 'feoh.record_transaction',
      { userId: adult.user.id, role: 'adult' },
      {
        date: '2026-07-05', payee: 'Market', amount: 60,
        postings: [{ envelopeId: envelope.id, debit: 60, credit: 0 }, { accountId: account.id, debit: 0, credit: 60 }],
      });

    const summary = await invokeTool(feohTools, 'feoh.get_month_summary',
      { userId: adult.user.id, role: 'adult' }, { month: '2026-07' }) as { totals: { spent: number } };
    expect(summary.totals.spent).toBe(60);
  });

  it('rejects an orphaned posting (no account or envelope) from an adult and writes nothing', async () => {
    const { adult } = await seedTestHousehold();

    await expect(
      invokeTool(feohTools, 'feoh.record_transaction',
        { userId: adult.user.id, role: 'adult' },
        {
          date: '2026-07-05', payee: 'Market', amount: 50,
          postings: [{ debit: 50, credit: 0 }, { debit: 0, credit: 50 }],
        }),
    ).rejects.toThrow(/reference an account or envelope/);

    const { rows } = await service.listTransactions({});
    expect(rows.length).toBe(0);
  });

  it('forbids a child from recording a transaction', async () => {
    const { child } = await seedTestHousehold();
    await expect(
      invokeTool(feohTools, 'feoh.record_transaction',
        { userId: child.user.id, role: 'child' },
        { date: '2026-07-05', payee: 'X', amount: 1, postings: [{ envelopeId: null, accountId: null, debit: 1, credit: 0 }, { debit: 0, credit: 1 }] }),
    ).rejects.toThrow(/finances/);
  });
});

// Ported from Feoh's tests/feoh-mcp.test.ts, adapted to Heorth's member
// semantics: no `parties` boundary — `createdBy` is derived from
// `ctx.principal.userId` (the auth-adapter-resolved household member), never
// a tool input, and expense splits carry `memberId` instead of `partyId`.
// The Feoh copy's "classified tool-error for an unknown createdBy party" case
// is dropped along with it (see src/modules/feoh/mcp.ts's docblock) — there
// is no parties table to validate against. Added here: a child-role
// principal gets the write gate's tool-error, and the registry assembled by
// `createApp` carries exactly the six `feoh.*` tools.
import { describe, it, expect } from 'vitest';
import { seedTestHousehold, invokeTool, collectMcpTools } from './helpers.js';
import { feohTools } from '../src/modules/feoh/mcp.js';
import * as service from '../src/modules/feoh/service.js';
import { ALL_MODULES } from '../src/modules/index.js';

describe('feoh MCP tools (unit-level, direct handler invocation)', () => {
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
      { userId: adult.user.id, role: 'adult' },
      { month: '2026-07' }) as { totals: { spent: number } };
    expect(summary.totals.spent).toBe(60);
  });

  it('rejects feoh.get_month_summary input with an out-of-range month (13)', async () => {
    const { adult } = await seedTestHousehold();

    await expect(
      invokeTool(feohTools, 'feoh.get_month_summary',
        { userId: adult.user.id, role: 'adult' },
        { month: '2026-13' }),
    ).rejects.toThrow();
  });

  it('records the acting member as createdBy, derived from the principal (not the input)', async () => {
    const { adult } = await seedTestHousehold();
    const account = await service.createAccount({ name: 'Checking', kind: 'asset', openingBalance: 0 });
    const envelope = await service.createEnvelope({ name: 'Groceries', monthlyBudget: 400 });

    await invokeTool(feohTools, 'feoh.record_transaction',
      { userId: adult.user.id, role: 'adult' },
      {
        date: '2026-07-05', payee: 'Market', amount: 25,
        postings: [{ envelopeId: envelope.id, debit: 25, credit: 0 }, { accountId: account.id, debit: 0, credit: 25 }],
      });

    const { rows } = await service.listTransactions({});
    expect(rows[0]!.createdBy).toBe(adult.user.id);
  });

  it('rejects an orphaned posting (no account or envelope) and writes nothing', async () => {
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

  it('returns a classified tool-error result (not a throw) for a child-role principal', async () => {
    const { child } = await seedTestHousehold();
    const account = await service.createAccount({ name: 'Checking', kind: 'asset', openingBalance: 0 });
    const envelope = await service.createEnvelope({ name: 'Groceries', monthlyBudget: 400 });

    const tool = feohTools.find((t) => t.name === 'feoh.record_transaction')!;
    const res = await tool.handler(
      { principal: { userId: child.user.id, role: 'child' }, requestId: 'test' },
      {
        date: '2026-07-05', payee: 'Market', amount: 50,
        postings: [{ envelopeId: envelope.id, debit: 50, credit: 0 }, { accountId: account.id, debit: 0, credit: 50 }],
      },
    );
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toMatch(/admin or adult/);

    const { rows } = await service.listTransactions({});
    expect(rows.length).toBe(0);
  });

  it('lists envelopes, bills, and exports a ledger', async () => {
    const { adult } = await seedTestHousehold();
    await service.createEnvelope({ name: 'Groceries', monthlyBudget: 400 });
    await service.createBill({ payee: 'Rent', amount: 1200, cadence: 'monthly', nextDue: '2026-08-01' });

    const envelopes = await invokeTool(feohTools, 'feoh.list_envelopes',
      { userId: adult.user.id, role: 'adult' }, {}) as { envelopes: unknown[] };
    expect(envelopes.envelopes.length).toBe(1);

    const bills = await invokeTool(feohTools, 'feoh.list_recurring_bills',
      { userId: adult.user.id, role: 'adult' }, {}) as { bills: unknown[] };
    expect(bills.bills.length).toBe(1);

    const ledger = await invokeTool(feohTools, 'feoh.export_ledger',
      { userId: adult.user.id, role: 'adult' }, {}) as { ledger: string };
    expect(typeof ledger.ledger).toBe('string');
  });

  it('imports transactions from CSV, attributing them to the acting member', async () => {
    const { adult } = await seedTestHousehold();
    const account = await service.createAccount({ name: 'Checking', kind: 'asset', openingBalance: 0 });
    await service.createEnvelope({ name: 'Groceries', monthlyBudget: 400 });
    const csv = `date,payee,memo,amount,envelope,account\n2026-07-05,Market,,60,Groceries,${account.name}`;

    const outcome = await invokeTool(feohTools, 'feoh.import_csv',
      { userId: adult.user.id, role: 'adult' }, { csv }) as { imported: number };
    expect(outcome.imported).toBe(1);

    const { rows } = await service.listTransactions({});
    expect(rows[0]!.createdBy).toBe(adult.user.id);
  });

  it('rejects feoh.import_csv from a child-role principal', async () => {
    const { child } = await seedTestHousehold();
    const csv = 'date,payee,memo,amount,envelope,account\n2026-07-05,Market,,60,Groceries,Checking';

    const tool = feohTools.find((t) => t.name === 'feoh.import_csv')!;
    const res = await tool.handler(
      { principal: { userId: child.user.id, role: 'child' }, requestId: 'test' },
      { csv },
    );
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toMatch(/admin or adult/);
  });
});

describe('feoh MCP tools do not include feoh.list_parties', () => {
  it('has exactly eleven tools, no list_parties', () => {
    expect(feohTools.map((t) => t.name).sort()).toEqual([
      'feoh.export_ledger',
      'feoh.get_item_costs',
      'feoh.get_month_summary',
      'feoh.import_csv',
      'feoh.link_item_cost',
      'feoh.link_occurrence',
      'feoh.list_envelopes',
      'feoh.list_occurrences',
      'feoh.list_recurring_bills',
      'feoh.record_transaction',
      'feoh.skip_occurrence',
    ]);
  });
});

describe('the assembled MCP registry (createApp)', () => {
  it('contains the eleven feoh.* tools (always registered)', () => {
    const tools = collectMcpTools(ALL_MODULES).all();
    const feohToolNames = tools.filter((t) => t.name.startsWith('feoh.')).map((t) => t.name);
    expect(feohToolNames.length).toBe(11);
    expect(feohToolNames).not.toContain('feoh.list_parties');
  });
});

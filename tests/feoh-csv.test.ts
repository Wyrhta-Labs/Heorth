// Ported from Feoh's tests/feoh-csv.test.ts, adapted to Heorth's member
// semantics: the household member's id (from seedTestHousehold) stands in
// for Feoh's `createTestParty`, and `importTransactionsCsv`/`recordTransaction`
// take it as the createdBy parameter instead of the input body. These tests
// call the service directly (no HTTP routes), so they need no FEOH_ENABLED gate.
import { describe, it, expect } from 'vitest';
import { seedTestHousehold } from './helpers.js';
import * as service from '../src/modules/feoh/service.js';
import { parseCsv } from '../src/modules/feoh/csv.js';

describe('feoh CSV & ledger', () => {
  it('round-trips transactions through CSV import then export', async () => {
    const { adult } = await seedTestHousehold();
    await service.createAccount({ name: 'Checking', kind: 'asset', openingBalance: 0 });
    await service.createEnvelope({ name: 'Groceries', monthlyBudget: 400 });

    const inputCsv = [
      'date,payee,memo,amount,envelope,account',
      '2026-07-05,Market,Weekly shop,50,Groceries,Checking',
      '2026-07-08,"Café, corner",Coffee,4.5,Groceries,Checking',
    ].join('\n');

    const { imported } = await service.importTransactionsCsv(inputCsv, adult.user.id);
    expect(imported).toBe(2);

    const exported = await service.exportTransactionsCsv();
    const rows = parseCsv(exported);
    expect(rows[0]).toEqual(['date', 'payee', 'memo', 'amount', 'envelope', 'account']);
    const market = rows.find((r) => r[1] === 'Market')!;
    // Export emits canonical numeric(14,2) money strings (no lossy float round-trip).
    expect(market[3]).toBe('50.00');
    expect(market[4]).toBe('Groceries');
    expect(market[5]).toBe('Checking');
    // Quoted field with a comma survives the round-trip.
    const cafe = rows.find((r) => r[1] === 'Café, corner')!;
    expect(cafe[3]).toBe('4.50');
  });

  it('rejects import rows with an unresolved envelope/account name and writes nothing', async () => {
    const { adult } = await seedTestHousehold();
    await service.createAccount({ name: 'Checking', kind: 'asset', openingBalance: 0 });
    await service.createEnvelope({ name: 'Groceries', monthlyBudget: 400 });

    const inputCsv = [
      'date,payee,memo,amount,envelope,account',
      '2026-07-05,Market,Weekly shop,50,Nonexistent,Checking',
    ].join('\n');

    await expect(service.importTransactionsCsv(inputCsv, adult.user.id)).rejects.toThrow('UNKNOWN_REFERENCE');

    const { rows } = await service.listTransactions({});
    expect(rows.length).toBe(0);
  });

  it('rejects import rows with both envelope and account empty and writes nothing', async () => {
    const { adult } = await seedTestHousehold();
    await service.createAccount({ name: 'Checking', kind: 'asset', openingBalance: 0 });
    await service.createEnvelope({ name: 'Groceries', monthlyBudget: 400 });

    const inputCsv = [
      'date,payee,memo,amount,envelope,account',
      '2026-07-05,Market,Weekly shop,50,,',
    ].join('\n');

    await expect(service.importTransactionsCsv(inputCsv, adult.user.id)).rejects.toThrow('CSV_INVALID_ROW');

    const { rows } = await service.listTransactions({});
    expect(rows.length).toBe(0);
  });

  it('rejects import when a later row has a malformed date and writes nothing (all-or-nothing)', async () => {
    const { adult } = await seedTestHousehold();
    await service.createAccount({ name: 'Checking', kind: 'asset', openingBalance: 0 });
    await service.createEnvelope({ name: 'Groceries', monthlyBudget: 400 });

    const inputCsv = [
      'date,payee,memo,amount,envelope,account',
      '2026-07-05,Market,Weekly shop,50,Groceries,Checking',
      '2026-99-99,Market2,Bad date,10,Groceries,Checking',
    ].join('\n');

    await expect(service.importTransactionsCsv(inputCsv, adult.user.id)).rejects.toThrow('CSV_INVALID_ROW');

    const { rows } = await service.listTransactions({});
    expect(rows.length).toBe(0);
  });

  it('rejects import when a later row has a non-numeric amount and writes nothing (all-or-nothing)', async () => {
    const { adult } = await seedTestHousehold();
    await service.createAccount({ name: 'Checking', kind: 'asset', openingBalance: 0 });
    await service.createEnvelope({ name: 'Groceries', monthlyBudget: 400 });

    const inputCsv = [
      'date,payee,memo,amount,envelope,account',
      '2026-07-05,Market,Weekly shop,50,Groceries,Checking',
      '2026-07-06,Market2,Bad amount,NaN,Groceries,Checking',
    ].join('\n');

    await expect(service.importTransactionsCsv(inputCsv, adult.user.id)).rejects.toThrow('CSV_INVALID_ROW');

    const { rows } = await service.listTransactions({});
    expect(rows.length).toBe(0);
  });

  it('rejects a CSV missing the date column in the header and writes nothing', async () => {
    const { adult } = await seedTestHousehold();
    await service.createAccount({ name: 'Checking', kind: 'asset', openingBalance: 0 });
    await service.createEnvelope({ name: 'Groceries', monthlyBudget: 400 });

    const inputCsv = [
      'payee,memo,amount,envelope,account',
      'Market,Weekly shop,50,Groceries,Checking',
    ].join('\n');

    await expect(service.importTransactionsCsv(inputCsv, adult.user.id)).rejects.toThrow('CSV_INVALID_HEADER');

    const { rows } = await service.listTransactions({});
    expect(rows.length).toBe(0);
  });

  it('neutralizes formula-injection payees on export while leaving normal payees untouched', async () => {
    const { adult } = await seedTestHousehold();
    const account = await service.createAccount({ name: 'Checking', kind: 'asset', openingBalance: 0 });
    const envelope = await service.createEnvelope({ name: 'Groceries', monthlyBudget: 400 });
    await service.recordTransaction({
      date: '2026-07-05', payee: '=HYPERLINK("http://evil","x")', amount: 10, memo: null,
      postings: [{ envelopeId: envelope.id, debit: 10, credit: 0 }, { accountId: account.id, debit: 0, credit: 10 }],
      splits: [],
    }, adult.user.id);
    await service.recordTransaction({
      date: '2026-07-06', payee: 'Market', amount: 20, memo: null,
      postings: [{ envelopeId: envelope.id, debit: 20, credit: 0 }, { accountId: account.id, debit: 0, credit: 20 }],
      splits: [],
    }, adult.user.id);

    const exported = await service.exportTransactionsCsv();
    const rows = parseCsv(exported);
    const evil = rows.find((r) => r[1]?.includes('HYPERLINK'))!;
    expect(evil[1]!.startsWith("'=")).toBe(true);
    const market = rows.find((r) => r[1] === 'Market')!;
    expect(market[1]).toBe('Market');
  });

  it('exports one row per envelope posting for a multi-envelope transaction without dropping legs', async () => {
    const { adult } = await seedTestHousehold();
    const checking = await service.createAccount({ name: 'Checking', kind: 'asset', openingBalance: 0 });
    const groceries = await service.createEnvelope({ name: 'Groceries', monthlyBudget: 400 });
    const dining = await service.createEnvelope({ name: 'Dining', monthlyBudget: 200 });

    await service.recordTransaction({
      date: '2026-07-05', payee: 'Costco', amount: 50, memo: 'split trip',
      postings: [
        { envelopeId: groceries.id, debit: 30, credit: 0 },
        { envelopeId: dining.id, debit: 20, credit: 0 },
        { accountId: checking.id, debit: 0, credit: 50 },
      ],
      splits: [],
    }, adult.user.id);

    const exported = await service.exportTransactionsCsv();
    const rows = parseCsv(exported);
    const groceriesRow = rows.find((r) => r[4] === 'Groceries')!;
    const diningRow = rows.find((r) => r[4] === 'Dining')!;
    expect(groceriesRow).toBeDefined();
    expect(diningRow).toBeDefined();
    expect(groceriesRow[3]).toBe('30.00');
    expect(diningRow[3]).toBe('20.00');
    expect(groceriesRow[5]).toBe('Checking');
    expect(diningRow[5]).toBe('Checking');
  });

  it('exports a readable plaintext ledger', async () => {
    const { adult } = await seedTestHousehold();
    const account = await service.createAccount({ name: 'Checking', kind: 'asset', openingBalance: 0 });
    const envelope = await service.createEnvelope({ name: 'Groceries', monthlyBudget: 400 });
    await service.recordTransaction({
      date: '2026-07-05', payee: 'Market', amount: 50, memo: 'Weekly shop',
      postings: [{ envelopeId: envelope.id, debit: 50, credit: 0 }, { accountId: account.id, debit: 0, credit: 50 }],
      splits: [],
    }, adult.user.id);

    const ledger = await service.exportLedger();
    expect(ledger).toContain('2026-07-05 * Market');
    expect(ledger).toContain('Envelopes:Groceries  $50.00');
    expect(ledger).toContain('Accounts:Checking  -$50.00');
  });
});

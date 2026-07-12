import { describe, it, expect } from 'vitest';
import { seedTestHousehold } from './helpers.js';
import * as service from '../src/modules/feoh/service.js';
import { parseCsv } from '../src/modules/feoh/csv.js';

describe('feoh CSV & ledger', () => {
  it('round-trips transactions through CSV import then export', async () => {
    const { admin } = await seedTestHousehold();
    await service.createAccount({ name: 'Checking', kind: 'asset', openingBalance: 0 });
    await service.createEnvelope({ name: 'Groceries', monthlyBudget: 400 });

    const inputCsv = [
      'date,payee,memo,amount,envelope,account',
      '2026-07-05,Market,Weekly shop,50,Groceries,Checking',
      '2026-07-08,"Café, corner",Coffee,4.5,Groceries,Checking',
    ].join('\n');

    const { imported } = await service.importTransactionsCsv(inputCsv, admin.user.id);
    expect(imported).toBe(2);

    const exported = await service.exportTransactionsCsv();
    const rows = parseCsv(exported);
    expect(rows[0]).toEqual(['date', 'payee', 'memo', 'amount', 'envelope', 'account']);
    const market = rows.find((r) => r[1] === 'Market')!;
    expect(market[3]).toBe('50');
    expect(market[4]).toBe('Groceries');
    expect(market[5]).toBe('Checking');
    // Quoted field with a comma survives the round-trip.
    const cafe = rows.find((r) => r[1] === 'Café, corner')!;
    expect(cafe[3]).toBe('4.5');
  });

  it('rejects import rows with an unresolved envelope/account name and writes nothing', async () => {
    const { admin } = await seedTestHousehold();
    await service.createAccount({ name: 'Checking', kind: 'asset', openingBalance: 0 });
    await service.createEnvelope({ name: 'Groceries', monthlyBudget: 400 });

    const inputCsv = [
      'date,payee,memo,amount,envelope,account',
      '2026-07-05,Market,Weekly shop,50,Nonexistent,Checking',
    ].join('\n');

    await expect(service.importTransactionsCsv(inputCsv, admin.user.id)).rejects.toThrow('UNKNOWN_REFERENCE');

    const { rows } = await service.listTransactions({});
    expect(rows.length).toBe(0);
  });

  it('exports a readable plaintext ledger', async () => {
    const { admin } = await seedTestHousehold();
    const account = await service.createAccount({ name: 'Checking', kind: 'asset', openingBalance: 0 });
    const envelope = await service.createEnvelope({ name: 'Groceries', monthlyBudget: 400 });
    await service.recordTransaction({
      date: '2026-07-05', payee: 'Market', amount: 50, memo: 'Weekly shop',
      postings: [{ envelopeId: envelope.id, debit: 50, credit: 0 }, { accountId: account.id, debit: 0, credit: 50 }],
      splits: [],
    }, admin.user.id);

    const ledger = await service.exportLedger();
    expect(ledger).toContain('2026-07-05 * Market');
    expect(ledger).toContain('Envelopes:Groceries  $50.00');
    expect(ledger).toContain('Accounts:Checking  -$50.00');
  });
});

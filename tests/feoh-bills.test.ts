import { describe, it, expect } from 'vitest';
import { seedTestHousehold } from './helpers.js';
import * as service from '../src/modules/feoh/service.js';

describe('feoh recurring bills', () => {
  it('creates and lists a recurring bill', async () => {
    await seedTestHousehold();
    const envelope = await service.createEnvelope({ name: 'Utilities', monthlyBudget: 200 });
    await service.createBill({ payee: 'Power Co', amount: 85, cadence: 'P1M', nextDue: '2026-08-01', envelopeId: envelope.id });
    const bills = await service.listBills();
    expect(bills.length).toBe(1);
    expect(bills[0]!.payee).toBe('Power Co');
    expect(bills[0]!.cadence).toBe('P1M');
  });
});

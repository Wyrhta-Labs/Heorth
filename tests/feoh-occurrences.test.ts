// Occurrence state machine: projects due dates from a recurring bill's
// cadence and layers persisted rows (linked/skipped/overridden) on top.
// See task-8-brief.md for the full state-machine spec this test covers.
import { describe, it, expect } from 'vitest';
import { seedTestHousehold } from './helpers.js';
import * as service from '../src/modules/feoh/service.js';
import * as occurrences from '../src/modules/feoh/occurrences.js';
import { createBillSchema } from '../src/modules/feoh/validators.js';
import { db } from '../src/db/index.js';
import { recurringBills, recurringOccurrences } from '../src/modules/feoh/schema.js';
import { eq } from 'drizzle-orm';
import { projectDueDates } from '../src/modules/feoh/cadence.js';

async function mkBill(cadence: string, nextDue: string, amount: number) {
  return service.createBill({ payee: 'Test Payee', amount, cadence: cadence as never, nextDue, envelopeId: null });
}

async function mkTx(createdBy: string, envelopeId: string, accountId: string, amount: number, date: string) {
  const result = await service.recordTransaction({
    date, payee: 'Test Payee', memo: null, amount,
    postings: [
      { envelopeId, accountId: null, debit: amount, credit: 0 },
      { accountId, envelopeId: null, debit: 0, credit: amount },
    ],
    splits: [],
  }, createdBy);
  return result.transaction;
}

describe('feoh occurrence state machine', () => {
  it('lists projected occurrences as overdue (past) or planned (future) relative to today', async () => {
    const bill = await mkBill('monthly', '2026-06-01', 85);
    const today = '2026-08-16';
    const list = await occurrences.listOccurrences({ billId: bill.id }, today);
    const projected = projectDueDates('2026-06-01', 'monthly', occurrences_addMonths(today, 6));
    expect(list.length).toBe(projected.length);
    for (const e of list) {
      if (e.dueDate < today) expect(e.status).toBe('overdue');
      else expect(e.status).toBe('planned');
    }
  });

  it('links an occurrence to a transaction, rejects double-link/skip, and skip-then-link conflicts', async () => {
    const { adult } = await seedTestHousehold();
    const account = await service.createAccount({ name: 'Checking', kind: 'asset', openingBalance: 0 });
    const envelope = await service.createEnvelope({ name: 'Utilities', monthlyBudget: 200 });
    const bill = await mkBill('monthly', '2026-06-01', 85);
    const today = '2026-08-16';

    const txn = await mkTx(adult.user.id, envelope.id, account.id, 85, '2026-06-01');
    await occurrences.linkOccurrence({ billId: bill.id, dueDate: '2026-06-01', transactionId: txn.id });

    let list = await occurrences.listOccurrences({ billId: bill.id }, today);
    const paidEntry = list.find((e) => e.dueDate === '2026-06-01');
    expect(paidEntry?.status).toBe('paid');
    expect(paidEntry?.transactionId).toBe(txn.id);

    await expect(occurrences.linkOccurrence({ billId: bill.id, dueDate: '2026-06-01', transactionId: txn.id }))
      .rejects.toThrow('ALREADY_PAID');
    await expect(occurrences.skipOccurrence({ billId: bill.id, dueDate: '2026-06-01' }))
      .rejects.toThrow('ALREADY_PAID');

    // fresh date: skip then attempt link -> ALREADY_SKIPPED
    await occurrences.skipOccurrence({ billId: bill.id, dueDate: '2026-07-01' });
    await expect(occurrences.linkOccurrence({ billId: bill.id, dueDate: '2026-07-01', transactionId: txn.id }))
      .rejects.toThrow('ALREADY_SKIPPED');
  });

  it('rejects linking an off-cadence date as NOT_AN_OCCURRENCE', async () => {
    const { adult } = await seedTestHousehold();
    const account = await service.createAccount({ name: 'Checking', kind: 'asset', openingBalance: 0 });
    const envelope = await service.createEnvelope({ name: 'Utilities', monthlyBudget: 200 });
    const bill = await mkBill('monthly', '2026-06-01', 85);
    const txn = await mkTx(adult.user.id, envelope.id, account.id, 85, '2026-06-15');
    await expect(occurrences.linkOccurrence({ billId: bill.id, dueDate: '2026-06-15', transactionId: txn.id }))
      .rejects.toThrow('NOT_AN_OCCURRENCE');
  });

  it('overrideOccurrence persists a row with expectedAmount === override, and null prunes it', async () => {
    const bill = await mkBill('monthly', '2026-06-01', 85);
    const today = '2026-08-16';
    await occurrences.overrideOccurrence({ billId: bill.id, dueDate: '2026-06-01', amount: 120 });

    let list = await occurrences.listOccurrences({ billId: bill.id }, today);
    let entry = list.find((e) => e.dueDate === '2026-06-01');
    expect(entry?.overrideAmount).toBe(120);
    expect(entry?.expectedAmount).toBe(120);
    expect(entry?.status).toBe('overdue'); // status still derived from date

    await occurrences.overrideOccurrence({ billId: bill.id, dueDate: '2026-06-01', amount: null });
    const rows = await db.select().from(recurringOccurrences)
      .where(eq(recurringOccurrences.billId, bill.id));
    expect(rows.length).toBe(0);
  });

  it('unlinkOccurrence prunes back to pure projection; keeps row if an override remains', async () => {
    const { adult } = await seedTestHousehold();
    const account = await service.createAccount({ name: 'Checking', kind: 'asset', openingBalance: 0 });
    const envelope = await service.createEnvelope({ name: 'Utilities', monthlyBudget: 200 });
    const bill = await mkBill('monthly', '2026-06-01', 85);
    const today = '2026-08-16';
    const txn = await mkTx(adult.user.id, envelope.id, account.id, 85, '2026-06-01');

    await occurrences.linkOccurrence({ billId: bill.id, dueDate: '2026-06-01', transactionId: txn.id });
    await occurrences.unlinkOccurrence({ billId: bill.id, dueDate: '2026-06-01' });
    let rows = await db.select().from(recurringOccurrences).where(eq(recurringOccurrences.billId, bill.id));
    expect(rows.length).toBe(0);

    // link + override, then unlink -> row stays (override remains), status by date
    await occurrences.linkOccurrence({ billId: bill.id, dueDate: '2026-06-01', transactionId: txn.id });
    await occurrences.overrideOccurrence({ billId: bill.id, dueDate: '2026-06-01', amount: 90 });
    await occurrences.unlinkOccurrence({ billId: bill.id, dueDate: '2026-06-01' });
    rows = await db.select().from(recurringOccurrences).where(eq(recurringOccurrences.billId, bill.id));
    expect(rows.length).toBe(1);
    const list = await occurrences.listOccurrences({ billId: bill.id }, today);
    const entry = list.find((e) => e.dueDate === '2026-06-01');
    expect(entry?.status).toBe('overdue');
    expect(entry?.overrideAmount).toBe(90);
  });

  it('deleting a linked transaction prunes the now-untouched occurrence row', async () => {
    const { adult } = await seedTestHousehold();
    const account = await service.createAccount({ name: 'Checking', kind: 'asset', openingBalance: 0 });
    const envelope = await service.createEnvelope({ name: 'Utilities', monthlyBudget: 200 });
    const bill = await mkBill('monthly', '2026-06-01', 85);
    const txn = await mkTx(adult.user.id, envelope.id, account.id, 85, '2026-06-01');
    await occurrences.linkOccurrence({ billId: bill.id, dueDate: '2026-06-01', transactionId: txn.id });

    await service.deleteTransaction(txn.id);
    const rows = await db.select().from(recurringOccurrences).where(eq(recurringOccurrences.billId, bill.id));
    expect(rows.length).toBe(0);
  });

  it('marks a persisted row off-schedule after the bill is edited to a new nextDue', async () => {
    const { adult } = await seedTestHousehold();
    const account = await service.createAccount({ name: 'Checking', kind: 'asset', openingBalance: 0 });
    const envelope = await service.createEnvelope({ name: 'Utilities', monthlyBudget: 200 });
    const bill = await mkBill('monthly', '2026-06-01', 85);
    const today = '2026-08-16';
    const txn = await mkTx(adult.user.id, envelope.id, account.id, 85, '2026-06-01');
    await occurrences.linkOccurrence({ billId: bill.id, dueDate: '2026-06-01', transactionId: txn.id });

    await service.updateBill(bill.id, { nextDue: '2026-06-15' });
    const list = await occurrences.listOccurrences({ billId: bill.id }, today);
    const entry = list.find((e) => e.dueDate === '2026-06-01');
    expect(entry).toBeTruthy();
    expect(entry?.offSchedule).toBe(true);
    expect(entry?.status).toBe('paid');
  });

  it('handles an unknown cadence as a single unknown-status entry, blocked from linking', async () => {
    const [bill] = await db.insert(recurringBills).values({
      payee: 'Mystery Co', amount: 10, cadence: 'every blue moon', nextDue: '2026-07-01',
    }).returning();
    const today = '2026-08-16';

    const list = await occurrences.listOccurrences({ billId: bill!.id }, today);
    expect(list.length).toBe(1);
    expect(list[0]).toMatchObject({ status: 'unknown', cadenceUnknown: true, dueDate: '2026-07-01' });

    await expect(occurrences.linkOccurrence({ billId: bill!.id, dueDate: '2026-07-01', transactionId: 'irrelevant' }))
      .rejects.toThrow('NOT_AN_OCCURRENCE');

    const filtered = await occurrences.listOccurrences({ billId: bill!.id, status: 'unknown' }, today);
    expect(filtered.length).toBe(1);
    expect(filtered[0]!.dueDate).toBe('2026-07-01');
  });

  it('deleteBill throws BILL_HAS_HISTORY when a persisted occurrence exists, otherwise deletes', async () => {
    const { adult } = await seedTestHousehold();
    const account = await service.createAccount({ name: 'Checking', kind: 'asset', openingBalance: 0 });
    const envelope = await service.createEnvelope({ name: 'Utilities', monthlyBudget: 200 });
    const bill = await mkBill('monthly', '2026-06-01', 85);
    const txn = await mkTx(adult.user.id, envelope.id, account.id, 85, '2026-06-01');
    await occurrences.linkOccurrence({ billId: bill.id, dueDate: '2026-06-01', transactionId: txn.id });

    await expect(service.deleteBill(bill.id)).rejects.toThrow('BILL_HAS_HISTORY');

    const freshBill = await mkBill('monthly', '2026-06-01', 85);
    const deleted = await service.deleteBill(freshBill.id);
    expect(deleted?.id).toBe(freshBill.id);
  });

  it('rejects the legacy P1M cadence via createBillSchema', () => {
    const result = createBillSchema.safeParse({
      payee: 'Legacy', amount: 10, cadence: 'P1M', nextDue: '2026-08-01',
    });
    expect(result.success).toBe(false);
  });
});

function occurrences_addMonths(d: string, months: number): string {
  const [y, m, day] = d.split('-').map(Number);
  const total = y! * 12 + (m! - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const dim = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(day!, dim)).padStart(2, '0')}`;
}

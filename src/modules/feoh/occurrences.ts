import { db } from '../../db/index.js';
import { recurringBills, recurringOccurrences, transactions, type RecurringBill } from './schema.js';
import { eq, and, isNull } from 'drizzle-orm';
import { isCadence, projectDueDates, isProjectedDate, addPeriods, type Cadence } from './cadence.js';

export type OccurrenceStatus = 'planned' | 'paid' | 'overdue' | 'skipped' | 'unknown';
export interface OccurrenceEntry {
  billId: string; payee: string; dueDate: string; status: OccurrenceStatus;
  expectedAmount: number; overrideAmount: number | null; transactionId: string | null;
  offSchedule: boolean; cadenceUnknown: boolean;
}

function todayIso(): string { return new Date().toISOString().slice(0, 10); }
function addMonthsIso(d: string, months: number): string { return addPeriods(d, 'monthly', months); }

export async function listOccurrences(
  q: { from?: string; to?: string; billId?: string; status?: OccurrenceStatus },
  today: string = todayIso(),
): Promise<OccurrenceEntry[]> {
  const bills = q.billId
    ? await db.select().from(recurringBills).where(eq(recurringBills.id, q.billId))
    : await db.select().from(recurringBills);
  const horizon = q.to ?? addMonthsIso(today, 6);
  const cappedHorizon = horizon > addMonthsIso(today, 24) ? addMonthsIso(today, 24) : horizon;
  const out: OccurrenceEntry[] = [];

  for (const bill of bills) {
    const persisted = await db.select().from(recurringOccurrences)
      .where(eq(recurringOccurrences.billId, bill.id));
    const byDate = new Map(persisted.map((r) => [r.dueDate, r]));

    if (!isCadence(bill.cadence)) {
      out.push(entry(bill, bill.nextDue, 'unknown', null, true));
      continue;
    }
    const projected = projectDueDates(bill.nextDue, bill.cadence, cappedHorizon);
    const projectedSet = new Set(projected);
    const dates = [...new Set([...projected, ...persisted.map((r) => r.dueDate)])].sort();

    for (const dueDate of dates) {
      const row = byDate.get(dueDate) ?? null;
      const status: OccurrenceStatus =
        row?.transactionId ? 'paid'
        : row?.skipped ? 'skipped'
        : dueDate < today ? 'overdue' : 'planned';
      // overdue always included; from-filter applies to the rest
      if (status !== 'overdue' && q.from && dueDate < q.from) continue;
      const e = entry(bill, dueDate, status, row, false);
      e.offSchedule = row != null && !projectedSet.has(dueDate);
      out.push(e);
    }
  }
  const filtered = q.status ? out.filter((e) => e.status === q.status) : out;
  return filtered.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.payee.localeCompare(b.payee));
}

function entry(
  bill: RecurringBill, dueDate: string, status: OccurrenceStatus,
  row: { transactionId: string | null; overrideAmount: string | null } | null,
  cadenceUnknown: boolean,
): OccurrenceEntry {
  const override = row?.overrideAmount != null ? Number(row.overrideAmount) : null;
  return {
    billId: bill.id, payee: bill.payee, dueDate, status,
    expectedAmount: override ?? Number(bill.amount), overrideAmount: override,
    transactionId: row?.transactionId ?? null, offSchedule: false, cadenceUnknown,
  };
}

/** dueDate must be a projected date for the bill, or an already-persisted row
 *  (the off-schedule exception). Arbitrary dates are NOT occurrences. */
async function resolveTarget(billId: string, dueDate: string) {
  const [bill] = await db.select().from(recurringBills).where(eq(recurringBills.id, billId)).limit(1);
  if (!bill) throw new Error('NOT_FOUND_BILL');
  const [row] = await db.select().from(recurringOccurrences)
    .where(and(eq(recurringOccurrences.billId, billId), eq(recurringOccurrences.dueDate, dueDate))).limit(1);
  if (!row) {
    if (!isCadence(bill.cadence) || !isProjectedDate(bill.nextDue, bill.cadence as Cadence, dueDate)) {
      throw new Error('NOT_AN_OCCURRENCE');
    }
  }
  return { bill, row: row ?? null };
}

/** Concurrency: the select-then-insert can race with another caller on the
 *  same (billId, dueDate) — the unique index then raises 23505. Map that to
 *  the state error a re-read would have produced instead of leaking a 500. */
function mapOccurrenceConflict(e: unknown, row: { skipped: boolean } | null): never {
  if (e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === '23505') {
    throw new Error(row?.skipped ? 'ALREADY_SKIPPED' : 'ALREADY_PAID');
  }
  throw e;
}

export async function linkOccurrence(i: { billId: string; dueDate: string; transactionId: string }): Promise<void> {
  const { row } = await resolveTarget(i.billId, i.dueDate);
  const [txn] = await db.select().from(transactions).where(eq(transactions.id, i.transactionId)).limit(1);
  if (!txn) throw new Error('NOT_FOUND_TRANSACTION');
  if (row?.transactionId) throw new Error('ALREADY_PAID');
  if (row?.skipped) throw new Error('ALREADY_SKIPPED');
  try {
    if (row) {
      await db.update(recurringOccurrences).set({ transactionId: i.transactionId, updatedAt: new Date() })
        .where(eq(recurringOccurrences.id, row.id));
    } else {
      await db.insert(recurringOccurrences).values({ billId: i.billId, dueDate: i.dueDate, transactionId: i.transactionId });
    }
  } catch (e: unknown) { mapOccurrenceConflict(e, row); }
}

export async function skipOccurrence(i: { billId: string; dueDate: string }): Promise<void> {
  const { row } = await resolveTarget(i.billId, i.dueDate);
  if (row?.transactionId) throw new Error('ALREADY_PAID');
  if (row?.skipped) throw new Error('ALREADY_SKIPPED');
  try {
    if (row) {
      await db.update(recurringOccurrences).set({ skipped: true, updatedAt: new Date() })
        .where(eq(recurringOccurrences.id, row.id));
    } else {
      await db.insert(recurringOccurrences).values({ billId: i.billId, dueDate: i.dueDate, skipped: true });
    }
  } catch (e: unknown) { mapOccurrenceConflict(e, row); }
}

async function pruneIfUntouched(id: string): Promise<void> {
  await db.delete(recurringOccurrences).where(and(
    eq(recurringOccurrences.id, id),
    isNull(recurringOccurrences.transactionId),
    eq(recurringOccurrences.skipped, false),
    isNull(recurringOccurrences.overrideAmount),
  ));
}

export async function unlinkOccurrence(i: { billId: string; dueDate: string }): Promise<void> {
  const { row } = await resolveTarget(i.billId, i.dueDate);
  if (!row) return;
  await db.update(recurringOccurrences).set({ transactionId: null, updatedAt: new Date() })
    .where(eq(recurringOccurrences.id, row.id));
  await pruneIfUntouched(row.id);
}

export async function unskipOccurrence(i: { billId: string; dueDate: string }): Promise<void> {
  const { row } = await resolveTarget(i.billId, i.dueDate);
  if (!row) return;
  await db.update(recurringOccurrences).set({ skipped: false, updatedAt: new Date() })
    .where(eq(recurringOccurrences.id, row.id));
  await pruneIfUntouched(row.id);
}

export async function overrideOccurrence(i: { billId: string; dueDate: string; amount: number | null }): Promise<void> {
  const { row } = await resolveTarget(i.billId, i.dueDate);
  if (row) {
    await db.update(recurringOccurrences)
      .set({ overrideAmount: i.amount != null ? String(i.amount) : null, updatedAt: new Date() })
      .where(eq(recurringOccurrences.id, row.id));
    await pruneIfUntouched(row.id);
  } else if (i.amount != null) {
    await db.insert(recurringOccurrences).values({ billId: i.billId, dueDate: i.dueDate, overrideAmount: String(i.amount) });
  }
}

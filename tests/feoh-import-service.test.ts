import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { seedTestHousehold } from './helpers.js';
import * as feoh from '../src/modules/feoh/service.js';
import * as imp from '../src/modules/feoh/import/service.js';
import { postings, transactions } from '../src/modules/feoh/schema.js';
import { feohImportedTransactions } from '../src/modules/feoh/import/schema.js';
import { fakeLine } from './fake-source.js';

async function setup() {
  const { adult, admin } = await seedTestHousehold();
  const account = await feoh.createAccount({ name: 'Joint', kind: 'asset', openingBalance: 1000 });
  const groceries = await feoh.createEnvelope({ name: 'Groceries', monthlyBudget: 400 });
  const income = await feoh.createEnvelope({ name: 'Income', monthlyBudget: 0 });
  return { adult, admin, account, groceries, income };
}

async function balance(accountId: string): Promise<number> {
  const rows = await db.select().from(postings).where(eq(postings.accountId, accountId));
  return rows.reduce((s, p) => s + Number(p.debit) - Number(p.credit), 0);
}

describe('ingest()', () => {
  it('inserts unknown lines as pending and skips known source_ids (dedup is free)', async () => {
    await setup();
    const first = await imp.ingest([fakeLine({ sourceId: '1:1' }), fakeLine({ sourceId: '1:2' })]);
    expect(first).toEqual({ inserted: 2, booked: 0, skipped: 0 });
    const again = await imp.ingest([fakeLine({ sourceId: '1:1' }), fakeLine({ sourceId: '1:3' })]);
    expect(again).toEqual({ inserted: 1, booked: 0, skipped: 1 });
    const { total } = await imp.listInbox({});
    expect(total).toBe(3);
  });

  it('a Firefly split of three journal lines yields three rows; re-ingesting inserts nothing', async () => {
    await setup();
    const split = ['9:1', '9:2', '9:3'].map((sourceId) => fakeLine({ sourceId }));
    expect((await imp.ingest(split)).inserted).toBe(3);
    expect((await imp.ingest(split)).inserted).toBe(0);
  });

  it('books a rule hit through recordTransaction: two postings, account credited, attributed to the rule author', async () => {
    const { adult, account, groceries } = await setup();
    await imp.upsertAccountMapping({ sourceAccountId: '7', accountId: account.id });
    await imp.createRule({ pattern: 'rewe', envelopeId: groceries.id }, adult.user.id);
    const r = await imp.ingest([fakeLine({ sourceId: '2:1', amount: 42.1, direction: 'out' })]);
    expect(r.booked).toBe(1);
    const [row] = await db.select().from(feohImportedTransactions);
    expect(row!.status).toBe('booked');
    expect(row!.envelopeId).toBe(groceries.id);
    const txn = await feoh.getTransaction(row!.transactionId!);
    expect(txn!.transaction.createdBy).toBe(adult.user.id);
    expect(txn!.postings).toHaveLength(2);
    const env = txn!.postings.find((p) => p.envelopeId === groceries.id)!;
    const acc = txn!.postings.find((p) => p.accountId === account.id)!;
    expect(Number(env.debit)).toBe(42.1);
    expect(Number(acc.credit)).toBe(42.1);
    expect(await balance(account.id)).toBe(-42.1);
  });

  it('an inbound line debits the account and credits the envelope', async () => {
    const { adult, account, income } = await setup();
    await imp.upsertAccountMapping({ sourceAccountId: '7', accountId: account.id });
    await imp.createRule({ pattern: 'salary', envelopeId: income.id }, adult.user.id);
    await imp.ingest([fakeLine({ sourceId: '3:1', payee: 'ACME Salary', amount: 3000, direction: 'in' })]);
    expect(await balance(account.id)).toBe(3000);
  });

  it('never books a foreign-currency line, even on a rule hit', async () => {
    const { adult, account, groceries } = await setup();
    await imp.upsertAccountMapping({ sourceAccountId: '7', accountId: account.id });
    await imp.createRule({ pattern: 'rewe', envelopeId: groceries.id }, adult.user.id);
    const r = await imp.ingest([fakeLine({ sourceId: '4:1', currency: 'USD' })]);
    expect(r).toEqual({ inserted: 1, booked: 0, skipped: 0 });
    const [row] = await db.select().from(feohImportedTransactions);
    expect(row!.status).toBe('pending');
  });

  it('leaves a line pending when its source account is unmapped or no rule matches', async () => {
    const { adult, account, groceries } = await setup();
    await imp.createRule({ pattern: 'rewe', envelopeId: groceries.id }, adult.user.id);
    expect((await imp.ingest([fakeLine({ sourceId: '5:1' })])).booked).toBe(0); // unmapped
    await imp.upsertAccountMapping({ sourceAccountId: '7', accountId: account.id });
    expect((await imp.ingest([fakeLine({ sourceId: '5:2', payee: 'Aldi' })])).booked).toBe(0); // no rule
  });
});

describe('inbox lifecycle', () => {
  it('confirm books with the confirming member as author and the mapped account', async () => {
    const { adult, account, groceries } = await setup();
    await imp.upsertAccountMapping({ sourceAccountId: '7', accountId: account.id });
    await imp.ingest([fakeLine({ sourceId: '6:1', payee: 'Aldi' })]);
    const [pending] = await db.select().from(feohImportedTransactions);
    const booked = await imp.confirmInboxRow(pending!.id, { envelopeId: groceries.id }, adult.user.id);
    expect(booked.status).toBe('booked');
    expect(booked.appliedRuleId).toBeNull();
    const txn = await feoh.getTransaction(booked.transactionId!);
    expect(txn!.transaction.createdBy).toBe(adult.user.id);
  });

  it('confirm needs an explicit accountId when the source account is unmapped', async () => {
    const { adult, account, groceries } = await setup();
    await imp.ingest([fakeLine({ sourceId: '6:2', payee: 'Aldi' })]);
    const [pending] = await db.select().from(feohImportedTransactions);
    await expect(imp.confirmInboxRow(pending!.id, { envelopeId: groceries.id }, adult.user.id)).rejects.toThrow('ACCOUNT_UNMAPPED');
    const booked = await imp.confirmInboxRow(pending!.id, { envelopeId: groceries.id, accountId: account.id }, adult.user.id);
    expect(booked.status).toBe('booked');
  });

  it('confirm refuses a foreign-currency line and a non-pending line', async () => {
    const { adult, account, groceries } = await setup();
    await imp.upsertAccountMapping({ sourceAccountId: '7', accountId: account.id });
    await imp.ingest([fakeLine({ sourceId: '6:3', currency: 'USD' }), fakeLine({ sourceId: '6:4', payee: 'Aldi' })]);
    const rows = await db.select().from(feohImportedTransactions);
    const usd = rows.find((r) => r.sourceId === '6:3')!;
    const eur = rows.find((r) => r.sourceId === '6:4')!;
    await expect(imp.confirmInboxRow(usd.id, { envelopeId: groceries.id }, adult.user.id)).rejects.toThrow('CURRENCY_MISMATCH');
    await imp.dismissInboxRow(eur.id);
    await expect(imp.confirmInboxRow(eur.id, { envelopeId: groceries.id }, adult.user.id)).rejects.toThrow('NOT_PENDING');
    await expect(imp.dismissInboxRow(eur.id)).rejects.toThrow('NOT_PENDING');
  });

  it('deleting a booked transaction returns the line to pending and the pair check survives', async () => {
    const { adult, account, groceries } = await setup();
    await imp.upsertAccountMapping({ sourceAccountId: '7', accountId: account.id });
    await imp.createRule({ pattern: 'rewe', envelopeId: groceries.id }, adult.user.id);
    await imp.ingest([fakeLine({ sourceId: '7:1' })]);
    const [booked] = await db.select().from(feohImportedTransactions);
    const deleted = await feoh.deleteTransaction(booked!.transactionId!);
    expect(deleted).not.toBeNull();
    const [after] = await db.select().from(feohImportedTransactions);
    expect(after!.status).toBe('pending');
    expect(after!.transactionId).toBeNull();
    expect(after!.appliedRuleId).toBeNull();
    expect(after!.envelopeId).toBeNull();
    expect(await db.select().from(transactions)).toHaveLength(0);
    // re-import of the same line is still a no-op: the register kept the row
    expect((await imp.ingest([fakeLine({ sourceId: '7:1' })])).inserted).toBe(0);
  });

  it('two concurrent confirms of one line book exactly one transaction', async () => {
    const { adult, account, groceries } = await setup();
    await imp.upsertAccountMapping({ sourceAccountId: '7', accountId: account.id });
    await imp.ingest([fakeLine({ sourceId: '6:5', payee: 'Aldi' })]);
    const [pending] = await db.select().from(feohImportedTransactions);
    const results = await Promise.all([
      imp.confirmInboxRow(pending!.id, { envelopeId: groceries.id }, adult.user.id),
      imp.confirmInboxRow(pending!.id, { envelopeId: groceries.id }, adult.user.id),
    ]);
    expect(results.every((r) => r.status === 'booked')).toBe(true);
    expect(new Set(results.map((r) => r.transactionId)).size).toBe(1);
    expect(await db.select().from(transactions)).toHaveLength(1);
  });

  it('a confirm racing a dismiss ends with exactly one winner and a consistent row', async () => {
    const { adult, account, groceries } = await setup();
    await imp.upsertAccountMapping({ sourceAccountId: '7', accountId: account.id });
    await imp.ingest([fakeLine({ sourceId: '6:6', payee: 'Aldi' })]);
    const [pending] = await db.select().from(feohImportedTransactions);
    const settled = await Promise.allSettled([
      imp.confirmInboxRow(pending!.id, { envelopeId: groceries.id }, adult.user.id),
      imp.dismissInboxRow(pending!.id),
    ]);
    const fulfilled = settled.filter((s) => s.status === 'fulfilled');
    const rejected = settled.filter((s) => s.status === 'rejected') as PromiseRejectedResult[];
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0]!.reason as Error).message).toBe('NOT_PENDING');
    const [after] = await db.select().from(feohImportedTransactions);
    const txCount = (await db.select().from(transactions)).length;
    // either booked with its transaction, or dismissed with none — never a mix
    expect(after!.status === 'booked' ? after!.transactionId !== null && txCount === 1 : after!.status === 'dismissed' && after!.transactionId === null && txCount === 0).toBe(true);
  });

  it('addManualLine goes through ingest — prefixed source_id, rule hit books, repeat is a no-op', async () => {
    const { adult, account, groceries } = await setup();
    await imp.upsertAccountMapping({ sourceAccountId: 'cash', accountId: account.id });
    await imp.createRule({ pattern: 'bakery', envelopeId: groceries.id }, adult.user.id);
    const input = { sourceId: 'demo-1', sourceAccountId: 'cash', date: '2026-09-03', payee: 'Bakery', memo: null, amount: 3.5, direction: 'out' as const };
    const first = await imp.addManualLine(input);
    expect(first.created).toBe(true);
    expect(first.row.sourceId).toBe('manual:demo-1');
    expect(first.row.status).toBe('booked');
    expect(first.row.currency).toBe('EUR');
    const second = await imp.addManualLine(input);
    expect(second.created).toBe(false);
    expect(second.row.id).toBe(first.row.id);
  });
});

describe('rules re-evaluation', () => {
  it('creating or editing a rule books matching PENDING rows only, never booked ones', async () => {
    const { adult, account, groceries, income } = await setup();
    await imp.upsertAccountMapping({ sourceAccountId: '7', accountId: account.id });
    await imp.ingest([fakeLine({ sourceId: '8:1', payee: 'Rewe' }), fakeLine({ sourceId: '8:2', payee: 'Aldi' })]);
    const rule = await imp.createRule({ pattern: 'rewe', envelopeId: groceries.id }, adult.user.id);
    let rows = await db.select().from(feohImportedTransactions);
    expect(rows.find((r) => r.sourceId === '8:1')!.status).toBe('booked');
    expect(rows.find((r) => r.sourceId === '8:2')!.status).toBe('pending');
    // Editing the rule to also match Aldi books Aldi; the Rewe booking is untouched.
    await imp.updateRule(rule.id, { pattern: 'a', envelopeId: income.id });
    rows = await db.select().from(feohImportedTransactions);
    expect(rows.find((r) => r.sourceId === '8:2')!.status).toBe('booked');
    expect(rows.find((r) => r.sourceId === '8:2')!.envelopeId).toBe(income.id);
    expect(rows.find((r) => r.sourceId === '8:1')!.envelopeId).toBe(groceries.id);
  });

  it('mapping an account books pending rows that already matched a rule', async () => {
    const { adult, account, groceries } = await setup();
    await imp.createRule({ pattern: 'rewe', envelopeId: groceries.id }, adult.user.id);
    await imp.ingest([fakeLine({ sourceId: '10:1', sourceAccountId: '7', payee: 'Rewe' })]);
    let [row] = await db.select().from(feohImportedTransactions).where(eq(feohImportedTransactions.sourceId, '10:1'));
    expect(row!.status).toBe('pending');
    await imp.upsertAccountMapping({ sourceAccountId: '7', accountId: account.id });
    [row] = await db.select().from(feohImportedTransactions).where(eq(feohImportedTransactions.sourceId, '10:1'));
    expect(row!.status).toBe('booked');
    expect(row!.envelopeId).toBe(groceries.id);
  });
});

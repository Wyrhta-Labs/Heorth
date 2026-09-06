import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { pgErrorCode } from '@wyrhta/core/db';
import { identity } from '../src/wiring.js';
import { accounts, envelopes, transactions } from '../src/modules/feoh/schema.js';
import {
  feohImportAccounts, feohImportRules, feohImportedTransactions, feohImportState,
} from '../src/modules/feoh/import/schema.js';

async function member() {
  return identity.createUser({
    email: 'imp@test.local', handle: 'imp', password: 'pw-import-1',
    role: 'adult', displayName: 'Imp', avatarColor: 'sage',
  });
}

function line(over: Partial<typeof feohImportedTransactions.$inferInsert> = {}) {
  return {
    sourceId: '101:1', sourceAccountId: '7', date: '2026-09-01', payee: 'Rewe',
    memo: null, amount: '42.10', currency: 'EUR', direction: 'out', status: 'pending', ...over,
  };
}

describe('feoh_import_* schema', () => {
  it('inserts a pending line with defaults', async () => {
    const [row] = await db.insert(feohImportedTransactions).values(line()).returning();
    expect(row!.status).toBe('pending');
    expect(row!.transactionId).toBeNull();
    expect(row!.appliedRuleId).toBeNull();
  });

  it('source_id is UNIQUE — the idempotency guarantee (23505)', async () => {
    await db.insert(feohImportedTransactions).values(line());
    await expect(db.insert(feohImportedTransactions).values(line({ payee: 'Again' })))
      .rejects.toSatisfy((e: unknown) => pgErrorCode(e) === '23505');
  });

  it('rejects a non-positive amount, an unknown direction and an unknown status', async () => {
    await expect(db.insert(feohImportedTransactions).values(line({ amount: '0' }))).rejects.toThrow();
    await expect(db.insert(feohImportedTransactions).values(line({ direction: 'sideways' }))).rejects.toThrow();
    await expect(db.insert(feohImportedTransactions).values(line({ status: 'lost' }))).rejects.toThrow();
  });

  it('booked implies a transaction, and pending/dismissed imply none', async () => {
    await expect(db.insert(feohImportedTransactions).values(line({ status: 'booked' }))).rejects.toThrow();
    const m = await member();
    const [txn] = await db.insert(transactions).values({ date: '2026-09-01', payee: 'Rewe', amount: '42.10', createdBy: m.id }).returning();
    await expect(db.insert(feohImportedTransactions).values(line({ status: 'pending', transactionId: txn!.id }))).rejects.toThrow();
    const [ok] = await db.insert(feohImportedTransactions).values(line({ status: 'booked', transactionId: txn!.id })).returning();
    expect(ok!.status).toBe('booked');
  });

  it('a rule restricts deleting its author and its envelope (23001)', async () => {
    const m = await member();
    const [env] = await db.insert(envelopes).values({ name: 'Groceries', monthlyBudget: '400' }).returning();
    await db.insert(feohImportRules).values({ pattern: 'rewe', envelopeId: env!.id, createdBy: m.id });
    await expect(db.execute(sql`DELETE FROM users WHERE id = ${m.id}`))
      .rejects.toSatisfy((e: unknown) => pgErrorCode(e) === '23001');
    await expect(db.delete(envelopes)).rejects.toSatisfy((e: unknown) => pgErrorCode(e) === '23001');
  });

  it('a rule needs a non-empty pattern', async () => {
    const m = await member();
    const [env] = await db.insert(envelopes).values({ name: 'Groceries', monthlyBudget: '400' }).returning();
    await expect(db.insert(feohImportRules).values({ pattern: '', envelopeId: env!.id, createdBy: m.id })).rejects.toThrow();
  });

  it('an account mapping is unique per source account and restricts deleting the Feoh account', async () => {
    const [acc] = await db.insert(accounts).values({ name: 'Joint', kind: 'asset', openingBalance: '0' }).returning();
    await db.insert(feohImportAccounts).values({ sourceAccountId: '7', accountId: acc!.id });
    await expect(db.insert(feohImportAccounts).values({ sourceAccountId: '7', accountId: acc!.id }))
      .rejects.toSatisfy((e: unknown) => pgErrorCode(e) === '23505');
    await expect(db.delete(accounts)).rejects.toSatisfy((e: unknown) => pgErrorCode(e) === '23001');
  });

  it('deleting a rule nulls applied_rule_id on the lines it booked', async () => {
    const m = await member();
    const [env] = await db.insert(envelopes).values({ name: 'Groceries', monthlyBudget: '400' }).returning();
    const [rule] = await db.insert(feohImportRules).values({ pattern: 'rewe', envelopeId: env!.id, createdBy: m.id }).returning();
    const [row] = await db.insert(feohImportedTransactions).values(line({ appliedRuleId: rule!.id })).returning();
    await db.delete(feohImportRules);
    const [after] = await db.select().from(feohImportedTransactions);
    expect(after!.id).toBe(row!.id);
    expect(after!.appliedRuleId).toBeNull();
  });

  it('feed_key is unique in the state table', async () => {
    await db.insert(feohImportState).values({ feedKey: 'firefly:transactions' });
    await expect(db.insert(feohImportState).values({ feedKey: 'firefly:transactions' }))
      .rejects.toSatisfy((e: unknown) => pgErrorCode(e) === '23505');
  });
});

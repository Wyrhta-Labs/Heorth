import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { envelopes, transactions, expenseSplits } from '../src/modules/feoh/schema.js';
import { identity } from '../src/wiring.js';

describe('feoh schema', () => {
  it('stores an envelope with a numeric budget', async () => {
    const [row] = await db.insert(envelopes).values({ name: 'Groceries', monthlyBudget: '400.00', tone: 'sage' }).returning();
    expect(row!.name).toBe('Groceries');
    expect(row!.monthlyBudget).toBe('400.00');
  });

  it('restricts deleting a member referenced by a transaction (FK RESTRICT, 23001)', async () => {
    const member = await identity.createUser({
      email: 'finance-member@test.local', handle: 'finance-member', password: 'pw-finance-1',
      role: 'adult', displayName: 'Finance Member', avatarColor: 'sage',
    });
    await db.insert(transactions).values({
      date: '2026-08-10', payee: 'Landlord', amount: '1200.00', createdBy: member.id,
    });

    // Explicit `onDelete: 'restrict'` (schema.ts) raises Postgres's
    // restrict_violation (23001), not foreign_key_violation (23503) — that
    // code is what Postgres's implicit NO ACTION default would have produced.
    await expect(
      db.execute(sql`DELETE FROM users WHERE id = ${member.id}`),
    ).rejects.toMatchObject({ code: '23001' });
  });

  it('restricts deleting a member referenced by an expense split (FK RESTRICT, 23001)', async () => {
    const member = await identity.createUser({
      email: 'split-member@test.local', handle: 'split-member', password: 'pw-finance-2',
      role: 'adult', displayName: 'Split Member', avatarColor: 'sky',
    });
    const [txn] = await db.insert(transactions).values({
      date: '2026-08-10', payee: 'Zoo', amount: '30.00', createdBy: member.id,
    }).returning();
    await db.insert(expenseSplits).values({
      transactionId: txn!.id, memberId: member.id, share: '30.00',
    });

    // Explicit `onDelete: 'restrict'` (schema.ts) raises Postgres's
    // restrict_violation (23001), not foreign_key_violation (23503) — that
    // code is what Postgres's implicit NO ACTION default would have produced.
    await expect(
      db.execute(sql`DELETE FROM users WHERE id = ${member.id}`),
    ).rejects.toMatchObject({ code: '23001' });
  });
});

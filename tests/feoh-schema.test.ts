import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { envelopes, transactions } from '../src/modules/feoh/schema.js';
import { identity } from '../src/wiring.js';

describe('feoh schema', () => {
  it('stores an envelope with a numeric budget', async () => {
    const [row] = await db.insert(envelopes).values({ name: 'Groceries', monthlyBudget: '400.00', tone: 'sage' }).returning();
    expect(row!.name).toBe('Groceries');
    expect(row!.monthlyBudget).toBe('400.00');
  });

  it('restricts deleting a member referenced by a transaction (FK RESTRICT, 23503)', async () => {
    const member = await identity.createUser({
      email: 'finance-member@test.local', handle: 'finance-member', password: 'pw-finance-1',
      role: 'adult', displayName: 'Finance Member', avatarColor: 'sage',
    });
    await db.insert(transactions).values({
      date: '2026-08-10', payee: 'Landlord', amount: '1200.00', createdBy: member.id,
    });

    await expect(
      db.execute(sql`DELETE FROM users WHERE id = ${member.id}`),
    ).rejects.toMatchObject({ code: '23503' });
  });
});

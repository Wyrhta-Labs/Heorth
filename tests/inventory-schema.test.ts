import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { inventoryItems } from '../src/modules/inventory/schema.js';
import { feohItemCosts } from '../src/modules/feoh/schema.js';

describe('inventory/lifecycle schema', () => {
  it('inserts a minimal inventory item with defaults', async () => {
    const [row] = await db.insert(inventoryItems).values({ name: 'Washing machine' }).returning();
    expect(row!.decommissionedAt).toBeNull();
  });

  it('rejects a decommission date without a reason (pair check)', async () => {
    await expect(
      db.insert(inventoryItems).values({ name: 'X', decommissionedAt: '2026-01-01' }),
    ).rejects.toThrow();
  });

  it('rejects an occurrence that is both paid and skipped', async () => {
    // raw SQL always through sql`` (repo convention, see tests/feoh-schema.test.ts)
    await expect(db.execute(sql`
      INSERT INTO recurring_occurrences (bill_id, due_date, transaction_id, skipped)
      VALUES (gen_random_uuid(), '2026-01-01', gen_random_uuid(), true)`,
    )).rejects.toThrow();
  });

  it('enforces one purchase link per item (partial unique index)', async () => {
    // Two REAL transactions, one item, two 'purchase' links: second must fail.
    // Seed a member for created_by via helpers, then:
    const { seedTestHousehold } = await import('./helpers.js');
    const { adult } = await seedTestHousehold();
    const [item] = await db.insert(inventoryItems).values({ name: 'Z' }).returning();
    const txIds = await db.execute(sql`
      INSERT INTO transactions (date, payee, amount, created_by)
      VALUES ('2026-01-01', 'a', '1.00', ${adult.user.id}::uuid),
             ('2026-01-02', 'b', '2.00', ${adult.user.id}::uuid)
      RETURNING id`) as unknown as Array<{ id: string }>;
    await db.insert(feohItemCosts).values({ transactionId: txIds[0]!.id, itemId: item!.id, kind: 'purchase' });
    await expect(
      db.insert(feohItemCosts).values({ transactionId: txIds[1]!.id, itemId: item!.id, kind: 'purchase' }),
    ).rejects.toThrow();
  });
});

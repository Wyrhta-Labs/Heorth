import { describe, it, expect } from 'vitest';
import { seedTestHousehold } from './helpers.js';
import { db } from '../src/db/index.js';
import { envelopes } from '../src/modules/feoh/schema.js';

describe('feoh schema', () => {
  it('stores an envelope with a numeric budget', async () => {
    await seedTestHousehold();
    const [row] = await db.insert(envelopes).values({ name: 'Groceries', monthlyBudget: '400.00', tone: 'sage' }).returning();
    expect(row!.name).toBe('Groceries');
    expect(row!.monthlyBudget).toBe('400.00');
  });
});

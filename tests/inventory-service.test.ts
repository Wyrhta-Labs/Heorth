import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import * as service from '../src/modules/inventory/service.js';

async function stubTransactionId(): Promise<string> {
  const { seedTestHousehold } = await import('./helpers.js');
  const { adult } = await seedTestHousehold();
  // postgres-js raw results are an ARRAY, not { rows }:
  const rows = (await db.execute(sql`
    INSERT INTO transactions (date, payee, amount, created_by)
    VALUES ('2026-08-01', 'stub', '10.00', ${adult.user.id}::uuid) RETURNING id`)) as unknown as Array<{ id: string }>;
  return rows[0]!.id;
}

describe('inventory service', () => {
  it('creates, lists with status/q filters, paginates', async () => {
    await service.createItem({ name: 'Bosch drill', manufacturer: 'Bosch', category: 'tool' });
    await service.createItem({ name: 'Washing machine', category: 'appliance' });
    const drill = (await service.listItems({ q: 'bosch' })).rows;
    expect(drill.length).toBe(1);
    const all = await service.listItems({});
    expect(all.total).toBe(2);
    expect((await service.listItems({ status: 'decommissioned' })).total).toBe(0);
  });

  it('decommissions once, rejects a second time', async () => {
    const item = await service.createItem({ name: 'Kettle' });
    const done = await service.decommissionItem(item.id, { date: '2026-08-01', reason: 'broken' });
    expect(done!.decommissionReason).toBe('broken');
    await expect(service.decommissionItem(item.id, { date: '2026-08-02', reason: 'broken' }))
      .rejects.toThrow('ALREADY_DECOMMISSIONED');
  });

  it('reactivates via all-null trio, blocks while a disposal link exists', async () => {
    const item = await service.createItem({ name: 'Bike' });
    await service.decommissionItem(item.id, { date: '2026-08-01', reason: 'sold', proceeds: 150 });
    const txId = await stubTransactionId();
    // Simulate the feoh-side disposal link with raw SQL (inventory must not import feoh):
    await db.execute(sql`
      INSERT INTO feoh_item_costs (transaction_id, item_id, kind)
      VALUES (${txId}::uuid, ${item.id}::uuid, 'disposal')`);
    await expect(service.updateItem(item.id, {
      decommissionedAt: null, decommissionReason: null, disposalProceeds: null,
    })).rejects.toThrow('DISPOSAL_LINK_EXISTS');
  });

  it('delete is blocked by finance links, allowed otherwise', async () => {
    const linked = await service.createItem({ name: 'TV' });
    const txId = await stubTransactionId();
    await db.execute(sql`
      INSERT INTO feoh_item_costs (transaction_id, item_id, kind)
      VALUES (${txId}::uuid, ${linked.id}::uuid, 'repair')`);
    await expect(service.deleteItem(linked.id)).rejects.toThrow('HAS_FINANCE_LINKS');
    const free = await service.createItem({ name: 'Chair' });
    expect((await service.deleteItem(free.id))!.id).toBe(free.id);
  });
});

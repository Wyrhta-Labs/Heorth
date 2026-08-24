import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import * as service from '../src/modules/ethel/service.js';
import { updateAssetSchema } from '../src/modules/ethel/validators.js';

async function stubTransactionId(): Promise<string> {
  const { seedTestHousehold } = await import('./helpers.js');
  const { adult } = await seedTestHousehold();
  // postgres-js raw results are an ARRAY, not { rows }:
  const rows = (await db.execute(sql`
    INSERT INTO transactions (date, payee, amount, created_by)
    VALUES ('2026-08-01', 'stub', '10.00', ${adult.user.id}::uuid) RETURNING id`)) as unknown as Array<{ id: string }>;
  return rows[0]!.id;
}

describe('ethel asset service', () => {
  it('creates, lists with status/q filters, paginates', async () => {
    await service.createAsset({ name: 'Bosch drill', manufacturer: 'Bosch', category: 'tool' });
    await service.createAsset({ name: 'Washing machine', category: 'appliance' });
    const drill = (await service.listAssets({ q: 'bosch' })).rows;
    expect(drill.length).toBe(1);
    const all = await service.listAssets({});
    expect(all.total).toBe(2);
    expect((await service.listAssets({ status: 'decommissioned' })).total).toBe(0);
  });

  it('escapes ILIKE wildcards in the search term so "100%" does not wildcard-match "1000 Watt"', async () => {
    await service.createAsset({ name: '100% Wool Blanket' });
    await service.createAsset({ name: '1000 Watt Heater' });
    const hits = (await service.listAssets({ q: '100%' })).rows;
    expect(hits.map((r) => r.name)).toEqual(['100% Wool Blanket']);
  });

  it('decommissions once, rejects a second time', async () => {
    const asset = await service.createAsset({ name: 'Kettle' });
    const done = await service.decommissionAsset(asset.id, { date: '2026-08-01', reason: 'broken' });
    expect(done!.decommissionReason).toBe('broken');
    await expect(service.decommissionAsset(asset.id, { date: '2026-08-02', reason: 'broken' }))
      .rejects.toThrow('ALREADY_DECOMMISSIONED');
  });

  it('reactivates via all-null trio, blocks while a disposal link exists', async () => {
    const asset = await service.createAsset({ name: 'Bike' });
    await service.decommissionAsset(asset.id, { date: '2026-08-01', reason: 'sold', proceeds: 150 });
    const txId = await stubTransactionId();
    // Simulate the feoh-side disposal link with raw SQL (ethel must not import feoh):
    await db.execute(sql`
      INSERT INTO feoh_item_costs (transaction_id, asset_id, kind)
      VALUES (${txId}::uuid, ${asset.id}::uuid, 'disposal')`);
    await expect(service.updateAsset(asset.id, {
      decommissionedAt: null, decommissionReason: null, disposalProceeds: null,
    })).rejects.toThrow('DISPOSAL_LINK_EXISTS');
  });

  it('delete is blocked by finance links, allowed otherwise', async () => {
    const linked = await service.createAsset({ name: 'TV' });
    const txId = await stubTransactionId();
    await db.execute(sql`
      INSERT INTO feoh_item_costs (transaction_id, asset_id, kind)
      VALUES (${txId}::uuid, ${linked.id}::uuid, 'repair')`);
    await expect(service.deleteAsset(linked.id)).rejects.toThrow('HAS_FINANCE_LINKS');
    const free = await service.createAsset({ name: 'Chair' });
    expect((await service.deleteAsset(free.id))!.id).toBe(free.id);
  });

  it('rejects a partial lifecycle trio (only two of three nulled)', () => {
    const result = updateAssetSchema.safeParse({
      decommissionedAt: null, decommissionReason: null,
    });
    expect(result.success).toBe(false);
  });

  it('reactivates successfully when no disposal link exists', async () => {
    const asset = await service.createAsset({ name: 'Ladder' });
    await service.decommissionAsset(asset.id, { date: '2026-08-01', reason: 'worn_out' });
    const reactivated = await service.updateAsset(asset.id, {
      decommissionedAt: null, decommissionReason: null, disposalProceeds: null,
    });
    expect(reactivated!.decommissionedAt).toBeNull();
    expect(reactivated!.decommissionReason).toBeNull();
    expect(reactivated!.disposalProceeds).toBeNull();
  });
});

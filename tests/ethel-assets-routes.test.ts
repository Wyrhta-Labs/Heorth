// Follows tests/feoh-bills.test.ts post-Task-1 idiom: static imports of
// createApp/ALL_MODULES, seedTestHousehold()/authHeaders() from tests/helpers.js.
import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { seedTestHousehold, authHeaders } from './helpers.js';
import { createApp } from '../src/app.js';
import { ALL_MODULES } from '../src/modules/index.js';

const app = createApp(ALL_MODULES);

async function stubTransactionId(adultUserId: string): Promise<string> {
  // postgres-js raw results are an ARRAY, not { rows }:
  const rows = (await db.execute(sql`
    INSERT INTO transactions (date, payee, amount, created_by)
    VALUES ('2026-08-01', 'stub', '10.00', ${adultUserId}::uuid) RETURNING id`)) as unknown as Array<{ id: string }>;
  return rows[0]!.id;
}

describe('ethel asset routes', () => {
  it('creates, lists (with meta total), gets, patches, decommissions, and deletes an asset', async () => {
    const { adult } = await seedTestHousehold();

    const created = await app.request('/api/v1/ethel/assets', {
      method: 'POST', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ name: 'Bosch drill', category: 'tool', manufacturer: 'Bosch' }),
    });
    expect(created.status).toBe(201);
    const { data: asset } = await created.json() as { data: { id: string; name: string } };
    expect(asset.name).toBe('Bosch drill');

    const list = await app.request('/api/v1/ethel/assets', { headers: authHeaders(adult.jwt) });
    expect(list.status).toBe(200);
    const listBody = await list.json() as { data: unknown[]; meta: { total: number } };
    expect(listBody.data.length).toBe(1);
    expect(listBody.meta.total).toBe(1);

    const got = await app.request(`/api/v1/ethel/assets/${asset.id}`, { headers: authHeaders(adult.jwt) });
    expect(got.status).toBe(200);
    const gotBody = await got.json() as { data: { name: string } };
    expect(gotBody.data.name).toBe('Bosch drill');

    const patched = await app.request(`/api/v1/ethel/assets/${asset.id}`, {
      method: 'PATCH', headers: authHeaders(adult.jwt), body: JSON.stringify({ name: 'Bosch hammer drill' }),
    });
    expect(patched.status).toBe(200);
    const patchedBody = await patched.json() as { data: { name: string } };
    expect(patchedBody.data.name).toBe('Bosch hammer drill');

    const decommissioned = await app.request(`/api/v1/ethel/assets/${asset.id}/decommission`, {
      method: 'POST', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ date: '2026-08-01', reason: 'broken' }),
    });
    expect(decommissioned.status).toBe(200);
    const decommissionedBody = await decommissioned.json() as { data: { decommissionReason: string } };
    expect(decommissionedBody.data.decommissionReason).toBe('broken');

    const secondDecommission = await app.request(`/api/v1/ethel/assets/${asset.id}/decommission`, {
      method: 'POST', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ date: '2026-08-02', reason: 'broken' }),
    });
    expect(secondDecommission.status).toBe(409);
    const secondBody = await secondDecommission.json() as { error: { code: string } };
    expect(secondBody.error.code).toBe('ALREADY_DECOMMISSIONED');

    const deleted = await app.request(`/api/v1/ethel/assets/${asset.id}`, {
      method: 'DELETE', headers: authHeaders(adult.jwt),
    });
    expect(deleted.status).toBe(200);
  });

  it('blocks deleting an asset with finance links with 409 HAS_FINANCE_LINKS', async () => {
    const { adult } = await seedTestHousehold();
    const created = await app.request('/api/v1/ethel/assets', {
      method: 'POST', headers: authHeaders(adult.jwt), body: JSON.stringify({ name: 'TV' }),
    });
    const { data: asset } = await created.json() as { data: { id: string } };
    const txId = await stubTransactionId(adult.user.id);
    await db.execute(sql`
      INSERT INTO feoh_item_costs (transaction_id, asset_id, kind)
      VALUES (${txId}::uuid, ${asset.id}::uuid, 'repair')`);

    const deleted = await app.request(`/api/v1/ethel/assets/${asset.id}`, {
      method: 'DELETE', headers: authHeaders(adult.jwt),
    });
    expect(deleted.status).toBe(409);
    const deletedBody = await deleted.json() as { error: { code: string } };
    expect(deletedBody.error.code).toBe('HAS_FINANCE_LINKS');
  });

  // The page shipped asking for `limit=200` against this cap and 400ed on
  // every load (fixed 2026-08-21). These pin the boundary, so the contract the
  // web client paginates against is stated in a test rather than inferred.
  it('rejects a limit above the cap with 400 VALIDATION_ERROR', async () => {
    const { adult } = await seedTestHousehold();
    for (const limit of [101, 200]) {
      const res = await app.request(`/api/v1/ethel/assets?limit=${limit}`, { headers: authHeaders(adult.jwt) });
      expect(res.status, `limit=${limit} must be rejected`).toBe(400);
      const body = await res.json() as { error: { code: string } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
    }
    const atCap = await app.request('/api/v1/ethel/assets?limit=100', { headers: authHeaders(adult.jwt) });
    expect(atCap.status, 'limit=100 is exactly at the cap and must be accepted').toBe(200);
  });

  it('paginates with limit/offset and reports total in meta', async () => {
    const { adult } = await seedTestHousehold();
    // Created out of order; the list sorts by name, so paging is deterministic.
    for (const name of ['Chisel', 'Anvil', 'Bellows']) {
      await app.request('/api/v1/ethel/assets', {
        method: 'POST', headers: authHeaders(adult.jwt), body: JSON.stringify({ name }),
      });
    }

    const first = await app.request('/api/v1/ethel/assets?limit=2&offset=0', { headers: authHeaders(adult.jwt) });
    expect(first.status).toBe(200);
    const firstBody = await first.json() as { data: Array<{ name: string }>; meta: { total: number; limit: number; offset: number } };
    expect(firstBody.data.map((i) => i.name)).toEqual(['Anvil', 'Bellows']);
    expect(firstBody.meta).toMatchObject({ total: 3, limit: 2, offset: 0 });

    const second = await app.request('/api/v1/ethel/assets?limit=2&offset=2', { headers: authHeaders(adult.jwt) });
    const secondBody = await second.json() as { data: Array<{ name: string }>; meta: { total: number; offset: number } };
    expect(secondBody.data.map((i) => i.name)).toEqual(['Chisel']);
    expect(secondBody.meta).toMatchObject({ total: 3, offset: 2 });
  });

  // The page searches server-side: once the list is paginated it cannot filter
  // client-side, because that would only ever search the loaded page.
  it('filters by q across name, manufacturer, model and serial, and totals the matches', async () => {
    const { adult } = await seedTestHousehold();
    const assets = [
      { name: 'Cordless drill', manufacturer: 'Bosch' },
      { name: 'Dishwasher', manufacturer: 'Miele', model: 'G 5310 SC' },
      { name: 'Boiler', serialNumber: 'VT-8832-114207' },
    ];
    for (const body of assets) {
      await app.request('/api/v1/ethel/assets', {
        method: 'POST', headers: authHeaders(adult.jwt), body: JSON.stringify(body),
      });
    }

    for (const [q, expected] of [['bosch', 'Cordless drill'], ['5310', 'Dishwasher'], ['114207', 'Boiler']] as const) {
      const res = await app.request(`/api/v1/ethel/assets?q=${q}&limit=50&offset=0`, { headers: authHeaders(adult.jwt) });
      expect(res.status).toBe(200);
      const body = await res.json() as { data: Array<{ name: string }>; meta: { total: number } };
      expect(body.data.map((i) => i.name)).toEqual([expected]);
      // `total` must count matches, not all rows, or load-more never terminates.
      expect(body.meta.total).toBe(1);
    }
  });

  it('rejects a child-role create with 403', async () => {
    const { child } = await seedTestHousehold();
    const res = await app.request('/api/v1/ethel/assets', {
      method: 'POST', headers: authHeaders(child.jwt), body: JSON.stringify({ name: 'Blocked' }),
    });
    expect(res.status).toBe(403);
  });

  it('rejects decommission without a reason with 400', async () => {
    const { adult } = await seedTestHousehold();
    const created = await app.request('/api/v1/ethel/assets', {
      method: 'POST', headers: authHeaders(adult.jwt), body: JSON.stringify({ name: 'Toaster' }),
    });
    const { data: asset } = await created.json() as { data: { id: string } };
    const res = await app.request(`/api/v1/ethel/assets/${asset.id}/decommission`, {
      method: 'POST', headers: authHeaders(adult.jwt), body: JSON.stringify({ date: '2026-08-01' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a PATCH with only a partial lifecycle trio with 400', async () => {
    const { adult } = await seedTestHousehold();
    const created = await app.request('/api/v1/ethel/assets', {
      method: 'POST', headers: authHeaders(adult.jwt), body: JSON.stringify({ name: 'Fridge' }),
    });
    const { data: asset } = await created.json() as { data: { id: string } };
    const res = await app.request(`/api/v1/ethel/assets/${asset.id}`, {
      method: 'PATCH', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ decommissionedAt: null }),
    });
    expect(res.status).toBe(400);
  });
});

describe('asset place filter', () => {
  it('filters to one place, then to a whole subtree, and unassigns on place delete', async () => {
    const { adult } = await seedTestHousehold();
    const h = authHeaders(adult.jwt);
    const place = async (body: unknown) => {
      const res = await app.request('/api/v1/ethel/places', { method: 'POST', headers: h, body: JSON.stringify(body) });
      return (await res.json() as { data: { id: string } }).data.id;
    };
    const asset = async (name: string, placeId: string) => {
      const res = await app.request('/api/v1/ethel/assets', {
        method: 'POST', headers: h, body: JSON.stringify({ name, placeId }),
      });
      expect(res.status).toBe(201);
      return (await res.json() as { data: { id: string } }).data.id;
    };

    const garage = await place({ name: 'Garage', kind: 'outdoor' });
    const shelf = await place({ name: 'Garage shelf', kind: 'storage', parentId: garage });
    await asset('Mower', garage);
    await asset('Drill', shelf);

    const direct = await app.request(`/api/v1/ethel/assets?placeId=${garage}`, { headers: h });
    expect((await direct.json() as { data: unknown[] }).data.length).toBe(1);

    const subtree = await app.request(`/api/v1/ethel/assets?placeId=${garage}&includeDescendants=true`, { headers: h });
    expect((await subtree.json() as { data: unknown[] }).data.length).toBe(2);

    const orphaned = await app.request('/api/v1/ethel/assets?includeDescendants=true', { headers: h });
    expect(orphaned.status).toBe(400);
    expect((await orphaned.json() as { error: { code: string } }).error.code).toBe('VALIDATION_ERROR');

    // Deleting a place UNASSIGNS its assets - it does not delete or block them.
    const del = await app.request(`/api/v1/ethel/places/${shelf}`, { method: 'DELETE', headers: h });
    expect(del.status).toBe(200);
    const all = await app.request('/api/v1/ethel/assets', { headers: h });
    const rows = (await all.json() as { data: Array<{ name: string; placeId: string | null }> }).data;
    expect(rows.find((r) => r.name === 'Drill')!.placeId).toBeNull();
    expect(rows.find((r) => r.name === 'Mower')!.placeId).toBe(garage);
  });

  // An unknown placeId is the caller's mistake: unmapped, the FK violation is a
  // raw 500 - the same hole PLACE_NOT_FOUND closed on the place routes.
  it('answers 400 PLACE_NOT_FOUND for an unknown placeId on create and on patch', async () => {
    const { adult } = await seedTestHousehold();
    const h = authHeaders(adult.jwt);
    const missing = '00000000-0000-0000-0000-000000000000';

    const created = await app.request('/api/v1/ethel/assets', {
      method: 'POST', headers: h, body: JSON.stringify({ name: 'Nowhere lamp', placeId: missing }),
    });
    expect(created.status).toBe(400);
    expect((await created.json() as { error: { code: string } }).error.code).toBe('PLACE_NOT_FOUND');

    const real = await app.request('/api/v1/ethel/assets', {
      method: 'POST', headers: h, body: JSON.stringify({ name: 'Somewhere lamp' }),
    });
    const { data: asset } = await real.json() as { data: { id: string } };
    const patched = await app.request(`/api/v1/ethel/assets/${asset.id}`, {
      method: 'PATCH', headers: h, body: JSON.stringify({ placeId: missing }),
    });
    expect(patched.status).toBe(400);
    expect((await patched.json() as { error: { code: string } }).error.code).toBe('PLACE_NOT_FOUND');
  });

  it('rejects limit=101 rather than clamping it', async () => {
    const { adult } = await seedTestHousehold();
    const res = await app.request('/api/v1/ethel/assets?limit=101', { headers: authHeaders(adult.jwt) });
    expect(res.status).toBe(400);
  });
});

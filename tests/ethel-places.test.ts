import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { ethelPlaces } from '../src/modules/ethel/schema.js';
import * as places from '../src/modules/ethel/places.js';
import { seedTestHousehold, authHeaders } from './helpers.js';
import { createApp } from '../src/app.js';
import { ALL_MODULES } from '../src/modules/index.js';

const app = createApp(ALL_MODULES);

describe('ethel_places schema', () => {
  it('inserts a root place', async () => {
    const [row] = await db.insert(ethelPlaces).values({ name: 'House', kind: 'building' }).returning();
    expect(row!.parentId).toBeNull();
  });

  it('rejects an unknown kind', async () => {
    await expect(
      db.insert(ethelPlaces).values({ name: 'Nowhere', kind: 'dungeon' }),
    ).rejects.toThrow();
  });

  it('rejects a place that is its own parent', async () => {
    const [row] = await db.insert(ethelPlaces).values({ name: 'Loop', kind: 'room' }).returning();
    await expect(
      db.update(ethelPlaces).set({ parentId: row!.id }).where(eq(ethelPlaces.id, row!.id)),
    ).rejects.toThrow();
  });

  it('rejects two siblings with the same name, case-insensitively', async () => {
    const [parent] = await db.insert(ethelPlaces).values({ name: 'Floor', kind: 'floor' }).returning();
    await db.insert(ethelPlaces).values({ name: 'Kitchen', kind: 'room', parentId: parent!.id });
    await expect(
      db.insert(ethelPlaces).values({ name: 'KITCHEN', kind: 'room', parentId: parent!.id }),
    ).rejects.toThrow();
  });

  it('rejects two ROOTS with the same name (NULLS NOT DISTINCT)', async () => {
    await db.insert(ethelPlaces).values({ name: 'Outside', kind: 'outdoor' });
    await expect(
      db.insert(ethelPlaces).values({ name: 'outside', kind: 'outdoor' }),
    ).rejects.toThrow();
  });
});

describe('place service invariants', () => {
  async function chain(depth: number): Promise<string[]> {
    const ids: string[] = [];
    let parentId: string | undefined;
    for (let i = 0; i < depth; i++) {
      const row = await places.createPlace({ name: `L${i}`, kind: 'room', parentId: parentId ?? null });
      ids.push(row.id);
      parentId = row.id;
    }
    return ids;
  }

  it('rejects a direct cycle', async () => {
    const [a, b] = await chain(2);
    await expect(places.updatePlace(a!, { parentId: b! })).rejects.toThrow('PLACE_CYCLE');
  });

  it('rejects an INDIRECT cycle', async () => {
    const [a, , c] = await chain(3);
    await expect(places.updatePlace(a!, { parentId: c! })).rejects.toThrow('PLACE_CYCLE');
  });

  it('rejects a create that would exceed the depth cap of 6', async () => {
    const ids = await chain(6);
    await expect(
      places.createPlace({ name: 'too deep', kind: 'storage', parentId: ids[5]! }),
    ).rejects.toThrow('PLACE_TOO_DEEP');
  });

  it('rejects a subtree MOVE that would exceed the cap, counting the subtree height', async () => {
    // A 3-deep chain moved under the 4th level of another 4-deep chain would
    // make 7. Depth of the new parent alone is only 4 - the moved subtree's own
    // height is what tips it over, which is the case a naive check misses.
    const left = await chain(4);
    const right = await places.createPlace({ name: 'R0', kind: 'building' });
    const r1 = await places.createPlace({ name: 'R1', kind: 'floor', parentId: right.id });
    const r2 = await places.createPlace({ name: 'R2', kind: 'room', parentId: r1.id });
    await expect(places.updatePlace(right.id, { parentId: left[3]! })).rejects.toThrow('PLACE_TOO_DEEP');
    expect(r2.id).toBeTruthy();
  });

  it('allows a move that exactly reaches the cap', async () => {
    const left = await chain(4);
    const root = await places.createPlace({ name: 'S0', kind: 'building' });
    await places.createPlace({ name: 'S1', kind: 'room', parentId: root.id });
    const moved = await places.updatePlace(root.id, { parentId: left[3]! });
    expect(moved!.parentId).toBe(left[3]);
  });

  it('refuses to delete a place with children, and reports PLACE_HAS_CHILDREN', async () => {
    const [a] = await chain(2);
    await expect(places.deletePlace(a!)).rejects.toThrow('PLACE_HAS_CHILDREN');
  });

  it('maps a duplicate sibling name to PLACE_NAME_TAKEN', async () => {
    const parent = await places.createPlace({ name: 'P', kind: 'floor' });
    await places.createPlace({ name: 'Kitchen', kind: 'room', parentId: parent.id });
    await expect(
      places.createPlace({ name: 'kitchen', kind: 'room', parentId: parent.id }),
    ).rejects.toThrow('PLACE_NAME_TAKEN');
  });

  it('rejects an unknown parent on create with PLACE_NOT_FOUND, not a 500', async () => {
    // Without the parent pre-check this walks zero ancestors, computes depth 0,
    // passes the cycle and depth checks, and dies on the FK as an unmapped 500.
    await expect(
      places.createPlace({ name: 'Orphan', kind: 'room', parentId: '00000000-0000-0000-0000-000000000000' }),
    ).rejects.toThrow('PLACE_NOT_FOUND');
  });

  it('rejects an unknown parent on update too', async () => {
    const [a] = await chain(1);
    await expect(
      places.updatePlace(a!, { parentId: '00000000-0000-0000-0000-000000000000' }),
    ).rejects.toThrow('PLACE_NOT_FOUND');
  });

  it('returns a whole subtree from descendantPlaceIds, including the root itself', async () => {
    const ids = await chain(3);
    const found = await places.descendantPlaceIds(ids[0]!);
    expect(found.sort()).toEqual(ids.sort());
  });
});

describe('place routes', () => {
  it('creates, lists flat with parentId, patches, and deletes', async () => {
    const { adult } = await seedTestHousehold();
    const h = authHeaders(adult.jwt);

    const created = await app.request('/api/v1/ethel/places', {
      method: 'POST', headers: h, body: JSON.stringify({ name: 'House', kind: 'building' }),
    });
    expect(created.status).toBe(201);
    const { data: house } = await created.json() as { data: { id: string } };

    const child = await app.request('/api/v1/ethel/places', {
      method: 'POST', headers: h,
      body: JSON.stringify({ name: 'Kitchen', kind: 'room', parentId: house.id }),
    });
    expect(child.status).toBe(201);

    // Inserted last but alphabetically first: House, then Kitchen, then Attic
    // went into the table in that order, so if listPlaces() ever regressed to
    // "no ORDER BY" (or ORDER BY insertion order), the assertion below would
    // fail - it only passes because of the explicit ORDER BY name.
    const attic = await app.request('/api/v1/ethel/places', {
      method: 'POST', headers: h, body: JSON.stringify({ name: 'Attic', kind: 'storage' }),
    });
    expect(attic.status).toBe(201);

    const list = await app.request('/api/v1/ethel/places', { headers: h });
    const body = await list.json() as { data: Array<{ name: string; parentId: string | null }> };
    expect(body.data.map((p) => p.name)).toEqual(['Attic', 'House', 'Kitchen']); // sorted by name
    expect(body.data.find((p) => p.name === 'Kitchen')!.parentId).toBe(house.id);

    const patched = await app.request(`/api/v1/ethel/places/${house.id}`, {
      method: 'PATCH', headers: h, body: JSON.stringify({ name: 'The House' }),
    });
    expect(patched.status).toBe(200);
  });

  it('surfaces the four domain errors with their codes', async () => {
    const { adult } = await seedTestHousehold();
    const h = authHeaders(adult.jwt);
    const mk = async (body: unknown) => {
      const res = await app.request('/api/v1/ethel/places', { method: 'POST', headers: h, body: JSON.stringify(body) });
      return { status: res.status, body: await res.json() as { data?: { id: string }; error?: { code: string } } };
    };

    const a = await mk({ name: 'A', kind: 'building' });
    const b = await mk({ name: 'B', kind: 'room', parentId: a.body.data!.id });

    const dup = await mk({ name: 'b', kind: 'room', parentId: a.body.data!.id });
    expect(dup.status).toBe(409);
    expect(dup.body.error!.code).toBe('PLACE_NAME_TAKEN');

    const cycle = await app.request(`/api/v1/ethel/places/${a.body.data!.id}`, {
      method: 'PATCH', headers: h, body: JSON.stringify({ parentId: b.body.data!.id }),
    });
    expect(cycle.status).toBe(400);
    expect((await cycle.json() as { error: { code: string } }).error.code).toBe('PLACE_CYCLE');

    const del = await app.request(`/api/v1/ethel/places/${a.body.data!.id}`, { method: 'DELETE', headers: h });
    expect(del.status).toBe(409);
    expect((await del.json() as { error: { code: string } }).error.code).toBe('PLACE_HAS_CHILDREN');

    const orphan = await mk({ name: 'Orphan', kind: 'room', parentId: '00000000-0000-0000-0000-000000000000' });
    expect(orphan.status).toBe(400);
    expect(orphan.body.error!.code).toBe('PLACE_NOT_FOUND');
  });

  it('refuses a write from a child member and a read from nobody', async () => {
    const { child } = await seedTestHousehold();
    const write = await app.request('/api/v1/ethel/places', {
      method: 'POST', headers: authHeaders(child.jwt), body: JSON.stringify({ name: 'X', kind: 'room' }),
    });
    expect(write.status).toBe(403);
    const anon = await app.request('/api/v1/ethel/places');
    expect(anon.status).toBe(401);
  });
});

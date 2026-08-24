import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { ethelFacilities } from '../src/modules/ethel/schema.js';
import { seedTestHousehold, authHeaders } from './helpers.js';
import { createApp } from '../src/app.js';
import { ALL_MODULES } from '../src/modules/index.js';

const app = createApp(ALL_MODULES);

async function fixture(jwt: string) {
  const h = authHeaders(jwt);
  const place = async (body: unknown) => {
    const res = await app.request('/api/v1/ethel/places', { method: 'POST', headers: h, body: JSON.stringify(body) });
    return (await res.json() as { data: { id: string } }).data.id;
  };
  const asset = async (name: string, placeId?: string) => {
    const res = await app.request('/api/v1/ethel/assets', {
      method: 'POST', headers: h, body: JSON.stringify({ name, placeId: placeId ?? null }),
    });
    return (await res.json() as { data: { id: string } }).data.id;
  };
  const utility = await place({ name: 'Utility room', kind: 'room' });
  const kitchen = await place({ name: 'Kitchen', kind: 'room' });
  const study = await place({ name: 'Study', kind: 'room' });
  return { h, utility, kitchen, study, boiler: await asset('Vaillant boiler', utility), asset };
}

describe('facility detail', () => {
  it('upserts 201 then 200, replacing the served set wholesale', async () => {
    const { adult } = await seedTestHousehold();
    const f = await fixture(adult.jwt);

    const created = await app.request(`/api/v1/ethel/assets/${f.boiler}/facility`, {
      method: 'PUT', headers: f.h,
      body: JSON.stringify({ kind: 'heating', commissionedOn: '2019-11-04', serviceIntervalMonths: 12, servesPlaceIds: [f.kitchen, f.study] }),
    });
    expect(created.status).toBe(201);

    const updated = await app.request(`/api/v1/ethel/assets/${f.boiler}/facility`, {
      method: 'PUT', headers: f.h,
      body: JSON.stringify({ kind: 'heating', servesPlaceIds: [f.kitchen] }),
    });
    expect(updated.status).toBe(200);

    const got = await app.request(`/api/v1/ethel/assets/${f.boiler}`, { headers: f.h });
    const detail = await got.json() as { data: { facility: { kind: string; servesPlaceIds: string[]; commissionedOn: string | null } } };
    // Wholesale replacement, not a merge: Study is gone, and commissionedOn
    // was not resent so it is cleared. PUT means PUT.
    expect(detail.data.facility.servesPlaceIds).toEqual([f.kitchen]);
    expect(detail.data.facility.commissionedOn).toBeNull();
  });

  it('accepts the same place twice, deduped, rather than 500ing on the PK', async () => {
    const { adult } = await seedTestHousehold();
    const f = await fixture(adult.jwt);
    const res = await app.request(`/api/v1/ethel/assets/${f.boiler}/facility`, {
      method: 'PUT', headers: f.h,
      body: JSON.stringify({ kind: 'heating', servesPlaceIds: [f.kitchen, f.kitchen] }),
    });
    expect(res.status).toBe(201);
    expect((await res.json() as { data: { servesPlaceIds: string[] } }).data.servesPlaceIds).toEqual([f.kitchen]);
  });

  it('accepts an empty served set', async () => {
    const { adult } = await seedTestHousehold();
    const f = await fixture(adult.jwt);
    const res = await app.request(`/api/v1/ethel/assets/${f.boiler}/facility`, {
      method: 'PUT', headers: f.h, body: JSON.stringify({ kind: 'water', servesPlaceIds: [] }),
    });
    expect(res.status).toBe(201);
  });

  it('rejects an unknown kind and an unknown served place', async () => {
    const { adult } = await seedTestHousehold();
    const f = await fixture(adult.jwt);
    expect((await app.request(`/api/v1/ethel/assets/${f.boiler}/facility`, {
      method: 'PUT', headers: f.h, body: JSON.stringify({ kind: 'teleportation', servesPlaceIds: [] }),
    })).status).toBe(400);

    const unknown = await app.request(`/api/v1/ethel/assets/${f.boiler}/facility`, {
      method: 'PUT', headers: f.h,
      body: JSON.stringify({ kind: 'heating', servesPlaceIds: ['00000000-0000-0000-0000-000000000000'] }),
    });
    expect(unknown.status).toBe(400);
    expect((await unknown.json() as { error: { code: string } }).error.code).toBe('PLACE_NOT_FOUND');
  });

  it('rejects a non-positive service interval', async () => {
    const { adult } = await seedTestHousehold();
    const f = await fixture(adult.jwt);
    expect((await app.request(`/api/v1/ethel/assets/${f.boiler}/facility`, {
      method: 'PUT', headers: f.h, body: JSON.stringify({ kind: 'heating', serviceIntervalMonths: 0, servesPlaceIds: [] }),
    })).status).toBe(400);
  });

  it('deleting a served place removes the LINK, not the facility', async () => {
    const { adult } = await seedTestHousehold();
    const f = await fixture(adult.jwt);
    await app.request(`/api/v1/ethel/assets/${f.boiler}/facility`, {
      method: 'PUT', headers: f.h, body: JSON.stringify({ kind: 'heating', servesPlaceIds: [f.kitchen, f.study] }),
    });
    expect((await app.request(`/api/v1/ethel/places/${f.study}`, { method: 'DELETE', headers: f.h })).status).toBe(200);
    const got = await app.request(`/api/v1/ethel/assets/${f.boiler}`, { headers: f.h });
    const detail = await got.json() as { data: { facility: { servesPlaceIds: string[] } } };
    expect(detail.data.facility.servesPlaceIds).toEqual([f.kitchen]);
  });

  it('drops the detail row with the asset (ON DELETE CASCADE)', async () => {
    const { adult } = await seedTestHousehold();
    const f = await fixture(adult.jwt);
    await app.request(`/api/v1/ethel/assets/${f.boiler}/facility`, {
      method: 'PUT', headers: f.h, body: JSON.stringify({ kind: 'heating', servesPlaceIds: [] }),
    });
    expect((await app.request(`/api/v1/ethel/assets/${f.boiler}`, { method: 'DELETE', headers: f.h })).status).toBe(200);
    expect((await db.select().from(ethelFacilities).where(eq(ethelFacilities.assetId, f.boiler))).length).toBe(0);
  });

  it('refuses a facility on an asset that already has a vehicle detail', async () => {
    const { adult } = await seedTestHousehold();
    const f = await fixture(adult.jwt);
    const car = await f.asset('Ford Focus');
    await app.request(`/api/v1/ethel/assets/${car}/vehicle`, { method: 'PUT', headers: f.h, body: JSON.stringify({ registration: 'AB12 CDE' }) });
    const res = await app.request(`/api/v1/ethel/assets/${car}/facility`, {
      method: 'PUT', headers: f.h, body: JSON.stringify({ kind: 'other', servesPlaceIds: [] }),
    });
    expect(res.status).toBe(409);
    expect((await res.json() as { error: { code: string } }).error.code).toBe('ASSET_DETAIL_CONFLICT');
  });

  it('DELETEs the detail row, keeps the asset, and drops the served-place links', async () => {
    const { adult } = await seedTestHousehold();
    const f = await fixture(adult.jwt);
    await app.request(`/api/v1/ethel/assets/${f.boiler}/facility`, {
      method: 'PUT', headers: f.h, body: JSON.stringify({ kind: 'heating', servesPlaceIds: [f.kitchen] }),
    });

    expect((await app.request(`/api/v1/ethel/assets/${f.boiler}/facility`, { method: 'DELETE', headers: f.h })).status).toBe(200);

    const got = await app.request(`/api/v1/ethel/assets/${f.boiler}`, { headers: f.h });
    const detail = await got.json() as { data: { name: string; facility: unknown } };
    expect(detail.data.facility).toBeNull();
    expect(detail.data.name).toBe('Vaillant boiler');

    // The links go by cascade, not by a second statement - prove it here.
    const serving = await app.request(`/api/v1/ethel/assets?servesPlaceId=${f.kitchen}`, { headers: f.h });
    expect((await serving.json() as { data: unknown[] }).data.length).toBe(0);
  });
});

describe('facility list filters', () => {
  it('lists the systems of the house, and what serves one room', async () => {
    const { adult } = await seedTestHousehold();
    const f = await fixture(adult.jwt);
    const inverter = await f.asset('PV inverter');
    await app.request(`/api/v1/ethel/assets/${f.boiler}/facility`, {
      method: 'PUT', headers: f.h, body: JSON.stringify({ kind: 'heating', servesPlaceIds: [f.kitchen, f.study] }),
    });
    await app.request(`/api/v1/ethel/assets/${inverter}/facility`, {
      method: 'PUT', headers: f.h, body: JSON.stringify({ kind: 'solar', servesPlaceIds: [] }),
    });
    await f.asset('Bosch drill'); // not a facility

    const facilities = await app.request('/api/v1/ethel/assets?hasFacility=true', { headers: f.h });
    const names = (await facilities.json() as { data: Array<{ name: string }> }).data.map((a) => a.name);
    expect(names.sort()).toEqual(['PV inverter', 'Vaillant boiler']);

    const serving = await app.request(`/api/v1/ethel/assets?servesPlaceId=${f.study}`, { headers: f.h });
    const servingNames = (await serving.json() as { data: Array<{ name: string }> }).data.map((a) => a.name);
    expect(servingNames).toEqual(['Vaillant boiler']);
  });

  it('does NOT walk the place tree for servesPlaceId', async () => {
    const { adult } = await seedTestHousehold();
    const f = await fixture(adult.jwt);
    const floorRes = await app.request('/api/v1/ethel/places', {
      method: 'POST', headers: f.h, body: JSON.stringify({ name: 'Ground floor', kind: 'floor' }),
    });
    const floor = (await floorRes.json() as { data: { id: string } }).data.id;
    await app.request(`/api/v1/ethel/places/${f.kitchen}`, {
      method: 'PATCH', headers: f.h, body: JSON.stringify({ parentId: floor }),
    });
    await app.request(`/api/v1/ethel/assets/${f.boiler}/facility`, {
      method: 'PUT', headers: f.h, body: JSON.stringify({ kind: 'heating', servesPlaceIds: [f.kitchen] }),
    });

    // A system serving a ROOM is not a system serving the FLOOR: widening it
    // would invent a claim the household never made (spec, open risks).
    const res = await app.request(`/api/v1/ethel/assets?servesPlaceId=${floor}`, { headers: f.h });
    expect((await res.json() as { data: unknown[] }).data.length).toBe(0);
  });
});

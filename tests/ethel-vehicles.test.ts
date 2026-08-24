import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { pgErrorCode } from '@wyrhta/core/db';
import { db } from '../src/db/index.js';
import { ethelVehicles } from '../src/modules/ethel/schema.js';
import { seedTestHousehold, authHeaders } from './helpers.js';
import { createApp } from '../src/app.js';
import { ALL_MODULES } from '../src/modules/index.js';

const app = createApp(ALL_MODULES);

async function newAsset(jwt: string, name = 'Ford Focus'): Promise<string> {
  const res = await app.request('/api/v1/ethel/assets', {
    method: 'POST', headers: authHeaders(jwt), body: JSON.stringify({ name }),
  });
  return (await res.json() as { data: { id: string } }).data.id;
}

describe('vehicle detail', () => {
  it('upserts 201 then 200, and inlines on GET /assets/:id but not on the list', async () => {
    const { adult } = await seedTestHousehold();
    const h = authHeaders(adult.jwt);
    const id = await newAsset(adult.jwt);

    const created = await app.request(`/api/v1/ethel/assets/${id}/vehicle`, {
      method: 'PUT', headers: h,
      body: JSON.stringify({ registration: 'AB12 CDE', vin: 'WF0AXXGCDA', firstRegisteredOn: '2019-03-01', odometer: 84000, odometerReadAt: '2026-08-01', serviceIntervalMonths: 12 }),
    });
    expect(created.status).toBe(201);

    const updated = await app.request(`/api/v1/ethel/assets/${id}/vehicle`, {
      method: 'PUT', headers: h, body: JSON.stringify({ registration: 'AB12 CDE', odometer: 85000, odometerReadAt: '2026-08-20' }),
    });
    expect(updated.status).toBe(200);

    const got = await app.request(`/api/v1/ethel/assets/${id}`, { headers: h });
    const detail = await got.json() as { data: { vehicle: { odometer: number; serviceIntervalMonths: number | null } | null } };
    expect(detail.data.vehicle!.odometer).toBe(85000);

    const list = await app.request('/api/v1/ethel/assets', { headers: h });
    const rows = (await list.json() as { data: Array<Record<string, unknown>> }).data;
    expect(rows[0]).not.toHaveProperty('vehicle');
  });

  it('404s an unknown asset', async () => {
    const { adult } = await seedTestHousehold();
    const res = await app.request('/api/v1/ethel/assets/00000000-0000-0000-0000-000000000000/vehicle', {
      method: 'PUT', headers: authHeaders(adult.jwt), body: JSON.stringify({ registration: 'X' }),
    });
    expect(res.status).toBe(404);
    // The CODE, not just the status: Hono's catch-all also answers 404, so a
    // status-only assertion passed even when this route did not exist at all.
    // NOT_FOUND in the body is what proves the route ran and looked.
    expect((await res.json() as { error: { code: string } }).error.code).toBe('NOT_FOUND');
  });

  it('rejects a duplicate registration and a duplicate VIN with distinct codes', async () => {
    const { adult } = await seedTestHousehold();
    const h = authHeaders(adult.jwt);
    const a = await newAsset(adult.jwt, 'Car A');
    const b = await newAsset(adult.jwt, 'Car B');
    await app.request(`/api/v1/ethel/assets/${a}/vehicle`, { method: 'PUT', headers: h, body: JSON.stringify({ registration: 'SAME1', vin: 'VIN1' }) });

    const dupReg = await app.request(`/api/v1/ethel/assets/${b}/vehicle`, { method: 'PUT', headers: h, body: JSON.stringify({ registration: 'SAME1' }) });
    expect(dupReg.status).toBe(409);
    expect((await dupReg.json() as { error: { code: string } }).error.code).toBe('VEHICLE_REGISTRATION_TAKEN');

    const dupVin = await app.request(`/api/v1/ethel/assets/${b}/vehicle`, { method: 'PUT', headers: h, body: JSON.stringify({ vin: 'VIN1' }) });
    expect(dupVin.status).toBe(409);
    expect((await dupVin.json() as { error: { code: string } }).error.code).toBe('VEHICLE_VIN_TAKEN');

    // Two vehicles with NO registration and NO vin must both be allowed.
    // NOT because the uniques are partial: Postgres treats NULLs as DISTINCT
    // in a unique index by default, so a plain unique would permit many NULLs
    // too - verified directly against the cluster. The
    // `WHERE ... IS NOT NULL` clause is an index-size optimisation, nothing
    // more. So no constraint could reject this pair; the test pins the intent,
    // not a mechanism.
    const c = await newAsset(adult.jwt, 'Car C');
    const d = await newAsset(adult.jwt, 'Car D');
    expect((await app.request(`/api/v1/ethel/assets/${c}/vehicle`, { method: 'PUT', headers: h, body: JSON.stringify({ odometer: 1, odometerReadAt: '2026-01-01' }) })).status).toBe(201);
    expect((await app.request(`/api/v1/ethel/assets/${d}/vehicle`, { method: 'PUT', headers: h, body: JSON.stringify({ odometer: 2, odometerReadAt: '2026-01-01' }) })).status).toBe(201);
  });

  it('rejects a mileage with no reading date, and a non-positive interval', async () => {
    const { adult } = await seedTestHousehold();
    const h = authHeaders(adult.jwt);
    const id = await newAsset(adult.jwt);
    expect((await app.request(`/api/v1/ethel/assets/${id}/vehicle`, { method: 'PUT', headers: h, body: JSON.stringify({ odometer: 1000 }) })).status).toBe(400);
    expect((await app.request(`/api/v1/ethel/assets/${id}/vehicle`, { method: 'PUT', headers: h, body: JSON.stringify({ serviceIntervalMonths: 0 }) })).status).toBe(400);
  });

  it('enforces the odometer pair in the DATABASE, not only in the validator', async () => {
    // Direct-to-DB, bypassing HTTP on purpose. The zod refinement above
    // shadows this CHECK at the HTTP level, so an HTTP test proves only that
    // the validator exists. If the constraint were dropped from the migration
    // nothing else in this file would notice - this is the only test that can
    // fail for that reason. Classified via pgErrorCode, never e.code:
    // a DrizzleQueryError's own code is undefined (23514 = check_violation).
    const { adult } = await seedTestHousehold();
    const id = await newAsset(adult.jwt, 'Direct insert car');
    const outcome = await db.insert(ethelVehicles)
      .values({ assetId: id, odometer: 12000, odometerReadAt: null })
      .then(() => null, (e: unknown) => e);
    expect(outcome, 'the odometer pair CHECK did not reject the insert').not.toBeNull();
    expect(pgErrorCode(outcome)).toBe('23514');
  });

  it('drops the detail row with the asset (ON DELETE CASCADE)', async () => {
    const { adult } = await seedTestHousehold();
    const h = authHeaders(adult.jwt);
    const id = await newAsset(adult.jwt);
    await app.request(`/api/v1/ethel/assets/${id}/vehicle`, { method: 'PUT', headers: h, body: JSON.stringify({ registration: 'GONE1' }) });
    expect((await app.request(`/api/v1/ethel/assets/${id}`, { method: 'DELETE', headers: h })).status).toBe(200);
    const left = await db.select().from(ethelVehicles).where(eq(ethelVehicles.assetId, id));
    expect(left.length).toBe(0);
  });

  it('DELETEs the detail row and keeps the asset', async () => {
    const { adult } = await seedTestHousehold();
    const h = authHeaders(adult.jwt);
    const id = await newAsset(adult.jwt);
    await app.request(`/api/v1/ethel/assets/${id}/vehicle`, { method: 'PUT', headers: h, body: JSON.stringify({ registration: 'KEEP1' }) });
    expect((await app.request(`/api/v1/ethel/assets/${id}/vehicle`, { method: 'DELETE', headers: h })).status).toBe(200);
    const got = await app.request(`/api/v1/ethel/assets/${id}`, { headers: h });
    expect((await got.json() as { data: { vehicle: unknown } }).data.vehicle).toBeNull();
  });

  it('refuses a vehicle on an asset that already has a facility detail', async () => {
    const { adult } = await seedTestHousehold();
    const h = authHeaders(adult.jwt);
    const id = await newAsset(adult.jwt, 'Boiler');
    await app.request(`/api/v1/ethel/assets/${id}/facility`, { method: 'PUT', headers: h, body: JSON.stringify({ kind: 'heating', servesPlaceIds: [] }) });
    const res = await app.request(`/api/v1/ethel/assets/${id}/vehicle`, { method: 'PUT', headers: h, body: JSON.stringify({ registration: 'NOPE1' }) });
    expect(res.status).toBe(409);
    expect((await res.json() as { error: { code: string } }).error.code).toBe('ASSET_DETAIL_CONFLICT');
  });
});

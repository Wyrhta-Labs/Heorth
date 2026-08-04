import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app.js';
import { householdModule } from '../src/household/index.js';
import { mealsModule } from '../src/modules/meals/index.js';
import { seedTestHousehold, authHeaders } from './helpers.js';

const app = createApp([householdModule, mealsModule]);

describe('meals routes', () => {
  it('creates a recipe and lists it', async () => {
    const { adult } = await seedTestHousehold();
    const create = await app.request('/api/v1/recipes', {
      method: 'POST', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ title: 'Chili', servings: 4, ingredients: [{ name: 'Beans', qty: 2, unit: 'can' }], steps: ['Simmer'], tags: ['veg'] }),
    });
    expect(create.status).toBe(201);
    const list = await app.request('/api/v1/recipes', { headers: authHeaders(adult.jwt) });
    const body = await list.json() as { data: unknown[] };
    expect(body.data.length).toBe(1);
  });

  it('upserts a meal plan entry idempotently by date+slot', async () => {
    const { adult } = await seedTestHousehold();
    const first = await app.request('/api/v1/meals/plan', {
      method: 'POST', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ date: '2026-07-13', slot: 'supper', freeText: 'Leftovers' }),
    });
    expect(first.status).toBe(201);
    const second = await app.request('/api/v1/meals/plan', {
      method: 'POST', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ date: '2026-07-13', slot: 'supper', freeText: 'Pizza night' }),
    });
    expect(second.status).toBe(201);

    const week = await app.request('/api/v1/meals/plan?from=2026-07-13&to=2026-07-19', { headers: authHeaders(adult.jwt) });
    const body = await week.json() as { data: Array<{ freeText: string }> };
    expect(body.data.length).toBe(1);
    expect(body.data[0]!.freeText).toBe('Pizza night');
  });
});

describe('maintenance admin quarantine', () => {
  it('refuses a recipe created by the admin', async () => {
    const { admin } = await seedTestHousehold();
    const res = await app.request('/api/v1/recipes', {
      method: 'POST', headers: authHeaders(admin.jwt),
      body: JSON.stringify({ title: 'Admin stew' }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('ADMIN_NOT_A_MEMBER');
  });

  it('refuses the admin as cook', async () => {
    const { admin, adult } = await seedTestHousehold();
    const res = await app.request('/api/v1/meals/plan', {
      method: 'POST', headers: authHeaders(adult.jwt),
      body: JSON.stringify({
        date: '2026-08-04', slot: 'supper', freeText: 'Pasta', cook: admin.user.id,
      }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('ADMIN_NOT_A_MEMBER');
  });

  it('refuses the admin as helper', async () => {
    const { admin, adult } = await seedTestHousehold();
    const res = await app.request('/api/v1/meals/plan', {
      method: 'POST', headers: authHeaders(adult.jwt),
      body: JSON.stringify({
        date: '2026-08-04', slot: 'supper', freeText: 'Pasta',
        cook: adult.user.id, helper: admin.user.id,
      }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('ADMIN_NOT_A_MEMBER');
  });

  it('still accepts an ordinary member as cook, and a null cook', async () => {
    const { adult } = await seedTestHousehold();
    const assigned = await app.request('/api/v1/meals/plan', {
      method: 'POST', headers: authHeaders(adult.jwt),
      body: JSON.stringify({
        date: '2026-08-04', slot: 'supper', freeText: 'Pasta', cook: adult.user.id,
      }),
    });
    expect(assigned.status).toBe(201);

    const unassigned = await app.request('/api/v1/meals/plan', {
      method: 'POST', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ date: '2026-08-05', slot: 'supper', freeText: 'Soup', cook: null }),
    });
    expect(unassigned.status).toBe(201);
  });
});

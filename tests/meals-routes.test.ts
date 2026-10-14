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

  it("embeds each entry's recipe in the plan, independent of the recipe list's paging", async () => {
    const { adult } = await seedTestHousehold();
    const createRecipe = async (title: string) => {
      const res = await app.request('/api/v1/recipes', {
        method: 'POST', headers: authHeaders(adult.jwt),
        body: JSON.stringify({ title, servings: 2, ingredients: [{ name: 'Salt', qty: 1, unit: 'pinch' }], steps: ['Cook'], tags: [] }),
      });
      return (await res.json() as { data: { id: string } }).data.id;
    };
    // 21 recipes sort before it, so it is not on GET /recipes' first page (20).
    for (let i = 1; i <= 21; i++) await createRecipe(`A${String(i).padStart(2, '0')}`);
    const zucchiniId = await createRecipe('Zucchini bake');
    const firstPage = await (await app.request('/api/v1/recipes', { headers: authHeaders(adult.jwt) })).json() as { data: Array<{ id: string }> };
    expect(firstPage.data.map((r) => r.id)).not.toContain(zucchiniId);

    await app.request('/api/v1/meals/plan', {
      method: 'POST', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ date: '2026-07-14', slot: 'supper', recipeId: zucchiniId }),
    });
    await app.request('/api/v1/meals/plan', {
      method: 'POST', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ date: '2026-07-15', slot: 'supper', freeText: 'Leftovers' }),
    });

    const week = await app.request('/api/v1/meals/plan?from=2026-07-13&to=2026-07-19', { headers: authHeaders(adult.jwt) });
    const body = await week.json() as { data: Array<{ date: string; recipeId: string | null; recipe: { id: string; title: string; ingredients: unknown[]; steps: string[] } | null }> };
    const [withRecipe, freeText] = body.data;
    expect(withRecipe!.recipeId).toBe(zucchiniId);
    expect(withRecipe!.recipe).toMatchObject({ id: zucchiniId, title: 'Zucchini bake', steps: ['Cook'] });
    expect(withRecipe!.recipe!.ingredients).toHaveLength(1);
    expect(freeText!.recipe).toBeNull();
  });
});

describe('recipe search (q)', () => {
  const seed = async () => {
    const { adult } = await seedTestHousehold();
    for (const title of ['Zucchini bake', 'Tomato soup', 'Chili con carne', '100% oat bars', 'Zucchini fritters']) {
      await app.request('/api/v1/recipes', {
        method: 'POST', headers: authHeaders(adult.jwt),
        body: JSON.stringify({ title, servings: 2, ingredients: [], steps: [], tags: [] }),
      });
    }
    return adult;
  };
  type Page = { data: Array<{ title: string }>; meta: { total: number; limit: number; offset: number } };
  const get = async (adult: Awaited<ReturnType<typeof seed>>, query: string) => {
    const res = await app.request(`/api/v1/recipes${query}`, { headers: authHeaders(adult.jwt) });
    return { status: res.status, body: await res.json() as Page };
  };

  it('matches a title substring, case-insensitively, sorted by title', async () => {
    const adult = await seed();
    const { body } = await get(adult, '?q=ZUCC');
    expect(body.data.map((r) => r.title)).toEqual(['Zucchini bake', 'Zucchini fritters']);
    expect(body.meta.total).toBe(2);
    expect((await get(adult, '?q=bake')).body.data.map((r) => r.title)).toEqual(['Zucchini bake']);
  });

  it('returns an empty page for no match', async () => {
    const adult = await seed();
    const { status, body } = await get(adult, '?q=pancake');
    expect(status).toBe(200);
    expect(body.data).toEqual([]);
    expect(body.meta.total).toBe(0);
  });

  it('pages within the matches and reports the match total', async () => {
    const adult = await seed();
    const first = (await get(adult, '?q=zucchini&limit=1')).body;
    expect(first.data.map((r) => r.title)).toEqual(['Zucchini bake']);
    expect(first.meta.total).toBe(2);
    const second = (await get(adult, '?q=zucchini&limit=1&offset=1')).body;
    expect(second.data.map((r) => r.title)).toEqual(['Zucchini fritters']);
  });

  it('treats LIKE wildcards in the term literally and ignores a blank term', async () => {
    const adult = await seed();
    expect((await get(adult, `?q=${encodeURIComponent('%')}`)).body.data.map((r) => r.title)).toEqual(['100% oat bars']);
    expect((await get(adult, `?q=${encodeURIComponent('_')}`)).body.data).toEqual([]);
    expect((await get(adult, '?q=%20%20')).body.meta.total).toBe(5);
  });

  it('matches a literal backslash in the title and in the term', async () => {
    const adult = await seed();
    await app.request('/api/v1/recipes', {
      method: 'POST', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ title: 'Back\\slash stew', servings: 2, ingredients: [], steps: [], tags: [] }),
    });
    expect((await get(adult, `?q=${encodeURIComponent('\\')}`)).body.data.map((r) => r.title)).toEqual(['Back\\slash stew']);
    expect((await get(adult, `?q=${encodeURIComponent('k\\s')}`)).body.data.map((r) => r.title)).toEqual(['Back\\slash stew']);
  });

  it('pages recipes with equal titles without repeating or skipping any', async () => {
    const { adult } = await seedTestHousehold();
    for (let i = 0; i < 5; i++) {
      await app.request('/api/v1/recipes', {
        method: 'POST', headers: authHeaders(adult.jwt),
        body: JSON.stringify({ title: 'Same', servings: 2, ingredients: [], steps: [], tags: [] }),
      });
    }
    const ids: string[] = [];
    for (let offset = 0; offset < 5; offset++) {
      const res = await app.request(`/api/v1/recipes?limit=1&offset=${offset}`, { headers: authHeaders(adult.jwt) });
      ids.push(...(await res.json() as { data: Array<{ id: string }> }).data.map((r) => r.id));
    }
    expect(new Set(ids).size).toBe(5);
    expect(ids).toEqual([...ids].sort());
  });

  it('rejects an over-long term', async () => {
    const adult = await seed();
    expect((await get(adult, `?q=${'a'.repeat(101)}`)).status).toBe(400);
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

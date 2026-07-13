import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app.js';
import { householdModule } from '../src/household/index.js';
import { libraryModule } from '../src/modules/library/index.js';
import { seedTestHousehold, authHeaders } from './helpers.js';

const app = createApp([householdModule, libraryModule]);

describe('library routes', () => {
  it('requires auth', async () => {
    const res = await app.request('/api/v1/library/connections');
    expect(res.status).toBe(401);
  });

  it('creates a LibraryThing connection and imports items', async () => {
    const { adult } = await seedTestHousehold();
    const create = await app.request('/api/v1/library/connections/librarything', {
      method: 'POST', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ userid: 'u1', key: 'k1' }),
    });
    expect(create.status).toBe(201);
    const conn = (await create.json() as { data: { id: string } }).data;

    const imp = await app.request(`/api/v1/library/connections/${conn.id}/import`, {
      method: 'POST', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ '1': { books_id: '1', title: 'Dune', authors: [{ fl: 'Frank Herbert' }], collections: { a: 'Read' } } }),
    });
    expect(imp.status).toBe(200);

    const items = await app.request('/api/v1/library/items', { headers: authHeaders(adult.jwt) });
    const body = await items.json() as { data: unknown[]; meta: { total: number } };
    expect(body.meta.total).toBe(1);
  });

  it('rejects an invalid LibraryThing body', async () => {
    const { adult } = await seedTestHousehold();
    const res = await app.request('/api/v1/library/connections/librarything', {
      method: 'POST', headers: authHeaders(adult.jwt), body: JSON.stringify({ userid: '' }),
    });
    expect(res.status).toBe(400);
  });
});

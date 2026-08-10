import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app.js';
import { seedTestHousehold, authHeaders } from './helpers.js';

describe('features', () => {
  const app = createApp([]);

  it('requires auth', async () => {
    const res = await app.request('/api/v1/features');
    expect(res.status).toBe(401);
  });

  it('reports finance disabled when FEOH_ENABLED is not set', async () => {
    const { child } = await seedTestHousehold();
    const res = await app.request('/api/v1/features', { headers: authHeaders(child.jwt) });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { finance: boolean } };
    expect(body.data.finance).toBe(false);
  });
});

// tests/feoh-accounts.test.ts
import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app.js';
import { householdModule } from '../src/household/index.js';
import { feohModule } from '../src/modules/feoh/index.js';
import { seedTestHousehold, authHeaders } from './helpers.js';

const app = createApp([householdModule, feohModule]);

describe('feoh accounts & envelopes', () => {
  it('adult can create an envelope; child cannot', async () => {
    const { adult, child } = await seedTestHousehold();
    const ok = await app.request('/api/v1/feoh/envelopes', {
      method: 'POST', headers: authHeaders(adult.jwt), body: JSON.stringify({ name: 'Groceries', monthlyBudget: 400 }),
    });
    expect(ok.status).toBe(201);

    const forbidden = await app.request('/api/v1/feoh/envelopes', {
      method: 'POST', headers: authHeaders(child.jwt), body: JSON.stringify({ name: 'Sweets', monthlyBudget: 20 }),
    });
    expect(forbidden.status).toBe(403);
  });

  it('a child can still read envelopes', async () => {
    const { adult, child } = await seedTestHousehold();
    await app.request('/api/v1/feoh/envelopes', {
      method: 'POST', headers: authHeaders(adult.jwt), body: JSON.stringify({ name: 'Groceries', monthlyBudget: 400 }),
    });
    const res = await app.request('/api/v1/feoh/envelopes', { headers: authHeaders(child.jwt) });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(body.data.length).toBe(1);
  });
});

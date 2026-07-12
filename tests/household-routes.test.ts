import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app.js';
import { householdModule } from '../src/household/index.js';
import { seedTestHousehold, authHeaders } from './helpers.js';

const app = createApp([householdModule]);

describe('household & members routes', () => {
  it('lists members for any authenticated role', async () => {
    const { child } = await seedTestHousehold();
    const res = await app.request('/api/v1/members', { headers: authHeaders(child.jwt) });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(body.data.length).toBe(3);
  });

  it('admin can create a member; adult and child get 403', async () => {
    const { admin, adult, child } = await seedTestHousehold();
    const payload = JSON.stringify({
      email: 'kid2@test.local', password: 'pw-kid2-12', displayName: 'Kid Two',
      avatarColor: 'ember', role: 'child',
    });

    const adminRes = await app.request('/api/v1/members', { method: 'POST', headers: authHeaders(admin.jwt), body: payload });
    expect(adminRes.status).toBe(201);

    const adultRes = await app.request('/api/v1/members', { method: 'POST', headers: authHeaders(adult.jwt), body: payload });
    expect(adultRes.status).toBe(403);

    const childRes = await app.request('/api/v1/members', { method: 'POST', headers: authHeaders(child.jwt), body: payload });
    expect(childRes.status).toBe(403);
  });

  it('admin can assign a role; non-admins cannot', async () => {
    const { admin, adult } = await seedTestHousehold();
    const ok = await app.request(`/api/v1/members/${adult.user.id}/role`, {
      method: 'PATCH', headers: authHeaders(admin.jwt), body: JSON.stringify({ role: 'admin' }),
    });
    expect(ok.status).toBe(200);
    const forbidden = await app.request(`/api/v1/members/${adult.user.id}/role`, {
      method: 'PATCH', headers: authHeaders(adult.jwt), body: JSON.stringify({ role: 'child' }),
    });
    expect(forbidden.status).toBe(403);
  });

  it('a member can PATCH their own profile but not another member', async () => {
    const { adult, child } = await seedTestHousehold();
    const self = await app.request(`/api/v1/members/${adult.user.id}`, {
      method: 'PATCH', headers: authHeaders(adult.jwt), body: JSON.stringify({ displayName: 'Grown Up' }),
    });
    expect(self.status).toBe(200);
    const other = await app.request(`/api/v1/members/${child.user.id}`, {
      method: 'PATCH', headers: authHeaders(adult.jwt), body: JSON.stringify({ displayName: 'Hacked' }),
    });
    expect(other.status).toBe(403);
  });

  it('logs in and returns a token; whoami reflects the caller', async () => {
    await seedTestHousehold();
    const login = await app.request('/api/v1/auth/token', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@test.local', password: 'test-admin-password' }),
    });
    expect(login.status).toBe(200);
    const { data } = await login.json() as { data: { token: string } };
    const who = await app.request('/api/v1/auth/whoami', {
      headers: { Authorization: `Bearer ${data.token}` },
    });
    expect(who.status).toBe(200);
    const whoBody = await who.json() as { data: { email: string; role: string } };
    expect(whoBody.data.email).toBe('admin@test.local');
    expect(whoBody.data.role).toBe('admin');
  });

  it('key-management rejects API-key auth (JWT only)', async () => {
    const { admin } = await seedTestHousehold();
    const created = await app.request('/api/v1/auth/keys', {
      method: 'POST', headers: authHeaders(admin.jwt), body: JSON.stringify({ name: 'agent' }),
    });
    expect(created.status).toBe(201);
    const { data } = await created.json() as { data: { key: string } };
    expect(data.key.startsWith('he_')).toBe(true);

    // Using the raw API key against a JWT-only route must fail.
    const withKey = await app.request('/api/v1/auth/keys', {
      headers: { Authorization: `Bearer ${data.key}` },
    });
    expect(withKey.status).toBe(401);
  });
});

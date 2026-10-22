import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app.js';
import { householdModule } from '../src/household/index.js';
import { seedTestHousehold, authHeaders } from './helpers.js';
import { config } from '../src/config/env.js';

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

  it('names the reason when a profile PATCH fails validation', async () => {
    const { adult } = await seedTestHousehold();
    const res = await app.request(`/api/v1/members/${adult.user.id}`, {
      method: 'PATCH', headers: authHeaders(adult.jwt), body: JSON.stringify({ password: 'short' }),
    });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: { message: string } }).error.message).toBe('Password must be at least 8 characters');
  });

  it('serves the timezone/locale option lists to any authenticated member', async () => {
    const { child } = await seedTestHousehold();
    const res = await app.request('/api/v1/household/options', { headers: authHeaders(child.jwt) });
    expect(res.status).toBe(200);
    const { data } = await res.json() as { data: { timezones: string[]; locales: { value: string; label: string }[] } };
    // UTC is the seeded default and must always be offered.
    expect(data.timezones[0]).toBe('UTC');
    expect(data.timezones).toContain('Europe/Berlin');
    expect(data.locales.map((l) => l.value)).toContain('en-GB');
  });

  it('rejects a timezone or locale outside the option lists', async () => {
    const { admin } = await seedTestHousehold();
    const patch = (body: unknown) => app.request('/api/v1/household', {
      method: 'PATCH', headers: authHeaders(admin.jwt), body: JSON.stringify(body),
    });

    const badZone = await patch({ timezone: 'Berlin' });
    expect(badZone.status).toBe(400);
    expect((await badZone.json() as { error: { message: string } }).error.message).toBe('Unsupported timezone');

    const badLocale = await patch({ locale: 'klingon' });
    expect(badLocale.status).toBe(400);
    expect((await badLocale.json() as { error: { message: string } }).error.message).toBe('Unsupported locale');

    const good = await patch({ timezone: 'Europe/Berlin', locale: 'de-DE' });
    expect(good.status).toBe(200);
    const { data } = await good.json() as { data: { timezone: string; locale: string } };
    expect(data.timezone).toBe('Europe/Berlin');
    expect(data.locale).toBe('de-DE');
  });

  it('serves the slate theme by default and the theme list in the options', async () => {
    const { child } = await seedTestHousehold();
    const res = await app.request('/api/v1/household', { headers: authHeaders(child.jwt) });
    expect(res.status).toBe(200);
    expect((await res.json() as { data: { theme: string } }).data.theme).toBe('slate');

    const opts = await app.request('/api/v1/household/options', { headers: authHeaders(child.jwt) });
    const { data } = await opts.json() as { data: { themes: { value: string; label: string }[] } };
    expect(data.themes.map((t) => t.value)).toEqual(['slate', 'hearth']);
  });

  it('serves the one Feoh currency, read-only, so the web formats money in it', async () => {
    const { admin, child } = await seedTestHousehold();
    const original = config.feohCurrency;
    try {
      (config as { feohCurrency: string }).feohCurrency = 'GBP';
      const res = await app.request('/api/v1/household', { headers: authHeaders(child.jwt) });
      expect((await res.json() as { data: { currency: string } }).data.currency).toBe('GBP');

      // It comes from FEOH_CURRENCY, not from the household row: a PATCH cannot set it.
      const patch = await app.request('/api/v1/household', {
        method: 'PATCH', headers: authHeaders(admin.jwt), body: JSON.stringify({ currency: 'USD' }),
      });
      expect((await patch.json() as { data: { currency: string } }).data.currency).toBe('GBP');
    } finally {
      (config as { feohCurrency: string }).feohCurrency = original;
    }
  });

  it('only an admin can switch the household theme, and only to a listed one', async () => {
    const { admin, adult } = await seedTestHousehold();
    const patch = (jwt: string, body: unknown) => app.request('/api/v1/household', {
      method: 'PATCH', headers: authHeaders(jwt), body: JSON.stringify(body),
    });

    expect((await patch(adult.jwt, { theme: 'hearth' })).status).toBe(403);

    const bad = await patch(admin.jwt, { theme: 'neon' });
    expect(bad.status).toBe(400);
    expect((await bad.json() as { error: { message: string } }).error.message).toBe('Unsupported theme');

    const good = await patch(admin.jwt, { theme: 'hearth' });
    expect(good.status).toBe(200);
    expect((await good.json() as { data: { theme: string } }).data.theme).toBe('hearth');

    // The theme survives a later edit that leaves it out, and reads back.
    const rename = await patch(admin.jwt, { name: 'Renamed' });
    expect((await rename.json() as { data: { theme: string } }).data.theme).toBe('hearth');
    const read = await app.request('/api/v1/household', { headers: authHeaders(adult.jwt) });
    expect((await read.json() as { data: { theme: string } }).data.theme).toBe('hearth');
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

  it('key management is admin/adult only; a child gets 403', async () => {
    const { adult, child } = await seedTestHousehold();

    const childList = await app.request('/api/v1/auth/keys', { headers: authHeaders(child.jwt) });
    expect(childList.status).toBe(403);

    const childCreate = await app.request('/api/v1/auth/keys', {
      method: 'POST', headers: authHeaders(child.jwt), body: JSON.stringify({ name: 'kid-agent' }),
    });
    expect(childCreate.status).toBe(403);

    const childRevoke = await app.request('/api/v1/auth/keys/00000000-0000-0000-0000-000000000000', {
      method: 'DELETE', headers: authHeaders(child.jwt),
    });
    expect(childRevoke.status).toBe(403);

    // An adult keeps full self-service: create, list, revoke.
    const created = await app.request('/api/v1/auth/keys', {
      method: 'POST', headers: authHeaders(adult.jwt), body: JSON.stringify({ name: 'adult-agent' }),
    });
    expect(created.status).toBe(201);
    const { data } = await created.json() as { data: { id: string } };

    const adultList = await app.request('/api/v1/auth/keys', { headers: authHeaders(adult.jwt) });
    expect(adultList.status).toBe(200);

    const revoked = await app.request(`/api/v1/auth/keys/${data.id}`, {
      method: 'DELETE', headers: authHeaders(adult.jwt),
    });
    expect(revoked.status).toBe(200);
  });
});

describe('household key overview (admin)', () => {
  async function mint(jwt: string, name: string): Promise<string> {
    const res = await app.request('/api/v1/auth/keys', {
      method: 'POST', headers: authHeaders(jwt), body: JSON.stringify({ name }),
    });
    return ((await res.json()) as { data: { id: string } }).data.id;
  }

  it('lists the keys of every member with their owner, never the secret', async () => {
    const { admin, adult } = await seedTestHousehold();
    await mint(admin.jwt, 'admin-agent');
    await mint(adult.jwt, 'adult-agent');

    const res = await app.request('/api/v1/household/keys', { headers: authHeaders(admin.jwt) });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<Record<string, unknown>> };
    const byName = Object.fromEntries(body.data.map((k) => [k['name'], k]));
    expect(Object.keys(byName).sort()).toEqual(['admin-agent', 'adult-agent']);
    expect(byName['adult-agent']).toMatchObject({
      prefix: expect.stringMatching(/^he_/),
      lastUsedAt: null,
      member: { id: adult.user.id, displayName: 'Adult', avatarColor: 'sage' },
    });
    for (const k of body.data) {
      expect(k).not.toHaveProperty('key');
      expect(k).not.toHaveProperty('keyHash');
    }
  });

  it('lets an admin revoke the key of another member', async () => {
    const { admin, adult } = await seedTestHousehold();
    const id = await mint(adult.jwt, 'adult-agent');

    const res = await app.request(`/api/v1/household/keys/${id}`, { method: 'DELETE', headers: authHeaders(admin.jwt) });
    expect(res.status).toBe(200);
    const own = await app.request('/api/v1/auth/keys', { headers: authHeaders(adult.jwt) });
    expect(((await own.json()) as { data: unknown[] }).data).toHaveLength(0);

    const again = await app.request(`/api/v1/household/keys/${id}`, { method: 'DELETE', headers: authHeaders(admin.jwt) });
    expect(again.status).toBe(404);
  });

  it('is admin only, and JWT only', async () => {
    const { admin, adult, child } = await seedTestHousehold();
    const id = await mint(admin.jwt, 'admin-agent');
    for (const who of [adult, child]) {
      const list = await app.request('/api/v1/household/keys', { headers: authHeaders(who.jwt) });
      expect(list.status).toBe(403);
      const del = await app.request(`/api/v1/household/keys/${id}`, { method: 'DELETE', headers: authHeaders(who.jwt) });
      expect(del.status).toBe(403);
    }

    const created = await app.request('/api/v1/auth/keys', {
      method: 'POST', headers: authHeaders(admin.jwt), body: JSON.stringify({ name: 'raw' }),
    });
    const { data } = await created.json() as { data: { key: string } };
    const withKey = await app.request('/api/v1/household/keys', { headers: { Authorization: `Bearer ${data.key}` } });
    expect(withKey.status).toBe(401);
  });
});

describe('maintenance admin protection', () => {
  it('refuses to delete the maintenance admin', async () => {
    const { admin } = await seedTestHousehold();
    const res = await app.request(`/api/v1/members/${admin.user.id}`, {
      method: 'DELETE', headers: authHeaders(admin.jwt),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('ADMIN_PROTECTED');
  });

  it('refuses to demote the maintenance admin', async () => {
    const { admin } = await seedTestHousehold();
    const res = await app.request(`/api/v1/members/${admin.user.id}/role`, {
      method: 'PATCH', headers: authHeaders(admin.jwt), body: JSON.stringify({ role: 'adult' }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('ADMIN_PROTECTED');
  });

  it('refuses to change the maintenance admin email', async () => {
    const { admin } = await seedTestHousehold();
    const res = await app.request(`/api/v1/members/${admin.user.id}`, {
      method: 'PATCH', headers: authHeaders(admin.jwt),
      body: JSON.stringify({ email: 'someone-else@test.local' }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('ADMIN_PROTECTED');
  });

  it('refuses to change the maintenance admin password', async () => {
    const { admin } = await seedTestHousehold();
    const res = await app.request(`/api/v1/members/${admin.user.id}`, {
      method: 'PATCH', headers: authHeaders(admin.jwt),
      body: JSON.stringify({ password: 'a-new-password-12' }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('ADMIN_PROTECTED');
  });

  it('still allows editing the admin display name', async () => {
    const { admin } = await seedTestHousehold();
    const res = await app.request(`/api/v1/members/${admin.user.id}`, {
      method: 'PATCH', headers: authHeaders(admin.jwt),
      body: JSON.stringify({ displayName: 'Maintenance' }),
    });
    expect(res.status).toBe(200);
  });

  it('refuses to create a member claiming the admin handle', async () => {
    const { admin } = await seedTestHousehold();
    const res = await app.request('/api/v1/members', {
      method: 'POST', headers: authHeaders(admin.jwt),
      body: JSON.stringify({
        email: 'imposter@test.local', password: 'pw-imposter-1',
        displayName: 'Imposter', avatarColor: 'sage', handle: 'admin',
      }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('ADMIN_PROTECTED');
  });

  it('still deletes an ordinary member', async () => {
    const { admin, child } = await seedTestHousehold();
    const res = await app.request(`/api/v1/members/${child.user.id}`, {
      method: 'DELETE', headers: authHeaders(admin.jwt),
    });
    expect(res.status).toBe(200);
  });
});

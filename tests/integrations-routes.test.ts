import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import { db } from '../src/db/index.js';
import { todoListAllowlist } from '../src/modules/tasks/schema.js';
import { setHouseholdList } from '../src/modules/tasks/store.js';
import { createApp, heorthErrorHandler } from '../src/app.js';
import { ALL_MODULES } from '../src/modules/index.js';
import { integrationsRouter } from '../src/integrations/routes.js';
import { seedTestHousehold, authHeaders } from './helpers.js';
import { clearProviders, registerProvider } from '../src/integrations/registry.js';
import { IntegrationStore } from '../src/integrations/store.js';
import { signConnectState } from '../src/integrations/state.js';
import { householdCore } from '../src/wiring.js';
import { config } from '../src/config/env.js';
import { setCalendarAllowlist, setHouseholdCalendar } from '../src/modules/calendar/allowlist-store.js';

const store = new IntegrationStore('m365');

function stubProvider() {
  return {
    id: 'm365',
    store,
    classifyError: () => 'error',
    fullResyncIntervalMs: 1000,
    authorizeUrl: (state: string) => `https://login.test/authorize?state=${state}`,
    completeConnect: async () => ({
      accountLabel: 'member@contoso.test', refreshToken: 'r', scopes: 'User.Read',
    }),
    calendar: null,
    tasks: null,
    runCalendarSync: async () => [{ feedKey: 'm365:calendar:family', status: 'ok' as const }],
    runTaskSync: async () => [],
  };
}

/**
 * Parameterised sibling of this suite's `stubProvider()`, which hardcodes
 * 'm365'. A second provider is the whole point of these cases.
 */
function registerStubProvider(id: string) {
  registerProvider({ ...stubProvider(), id, store: new IntegrationStore(id) });
}

/**
 * A bare app with just the integrations router mounted. `heorthErrorHandler` is
 * mounted explicitly because this app is NOT built via `createApp` — without it a
 * thrown MaintenanceAdminError would surface as an unhandled 500 rather than the
 * documented 403.
 */
function integrationsApp() {
  const app = new Hono();
  app.route('/api/v1/integrations', integrationsRouter);
  app.onError(heorthErrorHandler);
  return app;
}

describe('/api/v1/integrations', () => {
  beforeEach(() => {
    clearProviders();
    registerProvider(stubProvider());
  });

  it('requires auth on /:provider/connect', async () => {
    const res = await integrationsApp().request('/api/v1/integrations/m365/connect');
    expect(res.status).toBe(401);
  });

  it('redirects to the provider consent url on /:provider/connect', async () => {
    const { adult } = await seedTestHousehold();
    const res = await integrationsApp().request('/api/v1/integrations/m365/connect', {
      headers: authHeaders(adult.jwt),
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('https://login.test/authorize?state=');
  });

  it('returns a consent url for the acting member', async () => {
    const { adult } = await seedTestHousehold();
    const res = await integrationsApp().request('/api/v1/integrations/m365/connect-url', {
      headers: authHeaders(adult.jwt),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.url).toContain('https://login.test/authorize?state=');
  });

  it('requires auth on /:provider/connect-url', async () => {
    const res = await integrationsApp().request('/api/v1/integrations/m365/connect-url');
    expect(res.status).toBe(401);
  });

  it('refuses the maintenance admin on /:provider/connect-url', async () => {
    const { admin } = await seedTestHousehold();
    const res = await integrationsApp().request('/api/v1/integrations/m365/connect-url', {
      headers: authHeaders(admin.jwt),
    });
    expect(res.status).toBe(403);
  });

  it('404s for an unregistered provider', async () => {
    const { adult } = await seedTestHousehold();
    const res = await integrationsApp().request('/api/v1/integrations/google/connect-url', {
      headers: authHeaders(adult.jwt),
    });
    expect(res.status).toBe(404);
  });

  it('redirects with ADMIN_NOT_A_MEMBER when the callback state binds the maintenance admin', async () => {
    // Redirect (not throw): unlike /connect-url this is a browser navigation, so
    // a thrown MaintenanceAdminError must not surface as a raw JSON 403.
    const { admin } = await seedTestHousehold();
    const state = await signConnectState(admin.user.id);
    const res = await integrationsApp().request(
      `/api/v1/integrations/m365/callback?code=abc&state=${encodeURIComponent(state)}`,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/profile?connectError=ADMIN_NOT_A_MEMBER');
  });

  it('redirects with a consent-denied error when the callback carries an error query', async () => {
    const res = await integrationsApp().request('/api/v1/integrations/m365/callback?error=access_denied');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/profile?connectError=M365_CONSENT_DENIED');
  });

  it('redirects with a callback-invalid error when code or state is missing', async () => {
    const res = await integrationsApp().request('/api/v1/integrations/m365/callback');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/profile?connectError=M365_CALLBACK_INVALID');
  });

  it('rejects an invalid callback state', async () => {
    const res = await integrationsApp().request('/api/v1/integrations/m365/callback?code=abc&state=tampered');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/profile?connectError=M365_STATE_INVALID');
  });

  it('shows feeds to any authenticated session, including a child', async () => {
    await store.recordSyncSuccess('m365:calendar:family', 'tok');
    const { child } = await seedTestHousehold();
    const res = await integrationsApp().request('/api/v1/integrations/status', {
      headers: authHeaders(child.jwt),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.feeds.map((f: { feedKey: string }) => f.feedKey))
      .toContain('m365:calendar:family');
    // Household-wide connection list stays adult/admin only.
    expect(body.data.connections).toBeUndefined();
  });

  it('shows the same feeds[] set to a non-admin as to an admin, regardless of ownership', async () => {
    const { admin, adult, child } = await seedTestHousehold();
    await store.recordSyncFailure(`m365:calendar:member:${child.user.id}`, 'graph_401');
    await store.recordSyncSuccess('m365:calendar:family', null);

    const asAdult = await integrationsApp().request('/api/v1/integrations/status', {
      headers: authHeaders(adult.jwt),
    });
    const adultBody = await asAdult.json();
    const adultKeys = adultBody.data.feeds.map((f: { feedKey: string }) => f.feedKey);
    expect(adultKeys).toContain(`m365:calendar:member:${child.user.id}`);
    expect(adultKeys).toContain('m365:calendar:family');

    const asAdmin = await integrationsApp().request('/api/v1/integrations/status', {
      headers: authHeaders(admin.jwt),
    });
    const adminBody = await asAdmin.json();
    expect(adminBody.data.feeds.map((f: { feedKey: string }) => f.feedKey).sort()).toEqual(adultKeys.sort());
  });

  it('never projects the sync token', async () => {
    await store.recordSyncSuccess('m365:calendar:family', 'super-secret-delta-url');
    const { adult } = await seedTestHousehold();
    const res = await integrationsApp().request('/api/v1/integrations/status', {
      headers: authHeaders(adult.jwt),
    });
    expect(await res.text()).not.toContain('super-secret-delta-url');
  });

  // Pins the wire contract. Added 2026-08-30 after review found that the
  // account field silently changed from accountUpn to accountLabel three tasks
  // earlier and NO test noticed, because every existing assertion was about the
  // store's inputs rather than the route's output. The web client reads these
  // exact names.
  it('projects a connection with the documented field names', async () => {
    const { adult } = await seedTestHousehold();
    await store.upsertConnection({
      memberId: adult.user.id, accountLabel: 'a@contoso.test', refreshToken: 'r', scopes: 'User.Read',
    });
    const res = await integrationsApp().request('/api/v1/integrations/status', {
      headers: authHeaders(adult.jwt),
    });
    const conn = (await res.json()).data.connections[0];

    expect(Object.keys(conn).sort()).toEqual([
      'accountLabel', 'createdAt', 'id', 'lastRefreshError', 'lastRefreshSuccessAt',
      'memberId', 'provider', 'scopes', 'status', 'updatedAt',
    ]);
    expect(conn.accountLabel).toBe('a@contoso.test');
    expect(conn.provider).toBe('m365');
    // The one field that must never appear.
    expect(conn).not.toHaveProperty('refreshTokenEncrypted');
  });

  it('gives an adult the household-wide connection list', async () => {
    const { adult } = await seedTestHousehold();
    await store.upsertConnection({
      memberId: adult.user.id, accountLabel: 'a@contoso.test', refreshToken: 'r', scopes: '',
    });
    const res = await integrationsApp().request('/api/v1/integrations/status', {
      headers: authHeaders(adult.jwt),
    });
    const body = await res.json();
    expect(body.data.connections).toHaveLength(1);
    expect(body.data.connections[0]).not.toHaveProperty('refreshTokenEncrypted');
  });

  it('gives an admin session both the household-wide list and its own connection when the admin is a promoted member', async () => {
    // An admin session may itself be a promoted household member (role is not
    // the quarantine anchor — see maintenance-admin.ts): it must still see and
    // be able to act on its OWN connection, not just the household-wide list.
    const { adult } = await seedTestHousehold();
    await store.upsertConnection({
      memberId: adult.user.id, accountLabel: 'a@contoso.test', refreshToken: 'r', scopes: '',
    });

    // Promote to admin. Role, not handle, is the quarantine anchor's opposite —
    // this member is now an "admin session" but is not the maintenance admin
    // (that stays anchored on the `admin` handle from seedTestHousehold()).
    await householdCore.setRole(adult.user.id, 'admin');
    const promotedJwt = await sign(
      { sub: adult.user.id, role: 'admin', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 },
      config.jwtSecret,
    );

    const res = await integrationsApp().request('/api/v1/integrations/status', {
      headers: authHeaders(promotedJwt),
    });
    const body = await res.json();
    expect(body.data.myConnections).toHaveLength(1);
    expect(body.data.myConnections[0].accountLabel).toBe('a@contoso.test');
    expect(body.data.myConnections[0].provider).toBe('m365');
    expect(body.data.connections).toHaveLength(1);
  });

  it('restricts the manual sync trigger to admins', async () => {
    const { adult, admin } = await seedTestHousehold();
    const denied = await integrationsApp().request('/api/v1/integrations/sync', {
      method: 'POST', headers: authHeaders(adult.jwt), body: '{}',
    });
    expect(denied.status).toBe(403);

    const allowed = await integrationsApp().request('/api/v1/integrations/sync', {
      method: 'POST', headers: authHeaders(admin.jwt), body: '{}',
    });
    expect(allowed.status).toBe(200);
    expect((await allowed.json()).data.results).toHaveLength(1);
  });

  it('disconnects the acting member and 404s when there is nothing to disconnect', async () => {
    const { adult } = await seedTestHousehold();
    const empty = await integrationsApp().request('/api/v1/integrations/m365/connection', {
      method: 'DELETE', headers: authHeaders(adult.jwt),
    });
    expect(empty.status).toBe(404);

    await store.upsertConnection({
      memberId: adult.user.id, accountLabel: 'a@t', refreshToken: 'r', scopes: '',
    });
    const done = await integrationsApp().request('/api/v1/integrations/m365/connection', {
      method: 'DELETE', headers: authHeaders(adult.jwt),
    });
    expect(done.status).toBe(200);
  });

  // A bare app that never mounted /api/v1/m365 would 404 trivially and prove
  // nothing — this asserts against the real application's routing table.
  it('retires the old m365 route surface', async () => {
    const { adult } = await seedTestHousehold();
    const res = await createApp(ALL_MODULES).request('/api/v1/m365/status', { headers: authHeaders(adult.jwt) });
    expect(res.status).toBe(404);
  });

  it('reports whether a household task list is designated', async () => {
    const { adult } = await seedTestHousehold();
    const before = await integrationsApp().request('/api/v1/integrations/status', {
      headers: authHeaders(adult.jwt),
    });
    expect((await before.json()).data.householdListDesignated).toBe(false);

    await db.insert(todoListAllowlist).values({
      memberId: adult.user.id, provider: 'm365', listId: 'l1', listName: 'Household',
    });
    await setHouseholdList(adult.user.id, 'm365', 'l1');

    const after = await integrationsApp().request('/api/v1/integrations/status', {
      headers: authHeaders(adult.jwt),
    });
    expect((await after.json()).data.householdListDesignated).toBe(true);
  });

  it('reports householdListDesignated to a child session', async () => {
    const { child, adult } = await seedTestHousehold();
    const before = await integrationsApp().request('/api/v1/integrations/status', {
      headers: authHeaders(child.jwt),
    });
    expect((await before.json()).data.householdListDesignated).toBe(false);

    await db.insert(todoListAllowlist).values({
      memberId: adult.user.id, provider: 'm365', listId: 'l1', listName: 'Household',
    });
    await setHouseholdList(adult.user.id, 'm365', 'l1');

    const after = await integrationsApp().request('/api/v1/integrations/status', {
      headers: authHeaders(child.jwt),
    });
    expect((await after.json()).data.householdListDesignated).toBe(true);
  });
});

describe('GET /api/v1/integrations/status with two providers', () => {
  beforeEach(() => {
    clearProviders();
    registerProvider(stubProvider());
  });

  it('tags the acting member\'s own connections with their provider', async () => {
    const { adult } = await seedTestHousehold();
    registerStubProvider('m365');
    registerStubProvider('google');
    await new IntegrationStore('google').upsertConnection({
      memberId: adult.user.id, accountLabel: 'anna@gmail.test', refreshToken: 'r', scopes: '',
    });

    const res = await integrationsApp().request('/api/v1/integrations/status', { headers: authHeaders(adult.jwt) });
    const { data } = await res.json() as {
      data: { myConnections: Array<{ provider: string; accountLabel: string }> };
    };
    expect(data.myConnections).toEqual([
      expect.objectContaining({ provider: 'google', accountLabel: 'anna@gmail.test' }),
    ]);
  });

  it('reports no household calendar when none is designated', async () => {
    const { adult } = await seedTestHousehold();
    const res = await integrationsApp().request('/api/v1/integrations/status', { headers: authHeaders(adult.jwt) });
    const { data } = await res.json() as { data: { householdCalendar: unknown } };
    expect(data.householdCalendar).toBeNull();
  });

  it('reports the designated household calendar as disconnected when its member has no connection', async () => {
    const { adult } = await seedTestHousehold();
    registerStubProvider('google');
    await setCalendarAllowlist(adult.user.id, 'google', [{ id: 'cal-a', name: 'Familie' }]);
    await setHouseholdCalendar(adult.user.id, 'google', 'cal-a');

    const res = await integrationsApp().request('/api/v1/integrations/status', { headers: authHeaders(adult.jwt) });
    const { data } = await res.json() as {
      data: { householdCalendar: { calendarName: string; connectionOk: boolean } };
    };
    expect(data.householdCalendar).toMatchObject({ calendarName: 'Familie', connectionOk: false });
  });

  it('reports it as connected once that member connects', async () => {
    const { adult } = await seedTestHousehold();
    registerStubProvider('google');
    await new IntegrationStore('google').upsertConnection({
      memberId: adult.user.id, accountLabel: 'anna@gmail.test', refreshToken: 'r', scopes: '',
    });
    await setCalendarAllowlist(adult.user.id, 'google', [{ id: 'cal-a', name: 'Familie' }]);
    await setHouseholdCalendar(adult.user.id, 'google', 'cal-a');

    const res = await integrationsApp().request('/api/v1/integrations/status', { headers: authHeaders(adult.jwt) });
    const { data } = await res.json() as { data: { householdCalendar: { connectionOk: boolean } } };
    expect(data.householdCalendar.connectionOk).toBe(true);
  });

  it('still scopes the household-wide connections list to admin and adult', async () => {
    const { child } = await seedTestHousehold();
    registerStubProvider('google');
    const res = await integrationsApp().request('/api/v1/integrations/status', { headers: authHeaders(child.jwt) });
    const { data } = await res.json() as { data: { connections?: unknown; myConnections: unknown[] } };
    expect(data.connections).toBeUndefined();
    expect(data.myConnections).toEqual([]);
  });

  // The case above gives the child NO connection anywhere, so it can only prove
  // the admin/adult gate on `connections` — there is no data to leak, so a
  // regression to `listConnections()` for `myConnections` would pass it too.
  // This seeds the CHILD with their own connection AND a different member with
  // one, so "myConnections is scoped to the caller" is an actual claim about
  // data, not just about an empty list.
  it('scopes myConnections to the caller even when the caller has a connection of their own', async () => {
    const { child, adult } = await seedTestHousehold();
    registerStubProvider('m365');
    registerStubProvider('google');
    await new IntegrationStore('google').upsertConnection({
      memberId: child.user.id, accountLabel: 'kid@gmail.test', refreshToken: 'r', scopes: '',
    });
    await new IntegrationStore('m365').upsertConnection({
      memberId: adult.user.id, accountLabel: 'a@contoso.test', refreshToken: 'r', scopes: '',
    });

    const res = await integrationsApp().request('/api/v1/integrations/status', { headers: authHeaders(child.jwt) });
    const { data } = await res.json() as {
      data: { connections?: unknown; myConnections: Array<{ provider: string; accountLabel: string }> };
    };
    expect(data.myConnections).toEqual([
      expect.objectContaining({ provider: 'google', accountLabel: 'kid@gmail.test' }),
    ]);
    expect(JSON.stringify(data)).not.toContain('a@contoso.test');
    expect(data.connections).toBeUndefined();
  });
});

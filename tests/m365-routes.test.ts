import { describe, it, expect, afterEach } from 'vitest';
import { Hono } from 'hono';
import { createApp, heorthErrorHandler } from '../src/app.js';
import { ALL_MODULES } from '../src/modules/index.js';
import { m365Router } from '../src/m365/routes.js';
import { setM365Runtime } from '../src/m365/runtime.js';
import { signConnectState } from '../src/m365/state.js';
import { feedKeys } from '../src/m365/feed-keys.js';
import { eq } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { m365Connections } from '../src/m365/schema.js';
import { createFakeGraph, runtimeForFakeGraph } from './fake-graph.js';
import { seedTestHousehold, authHeaders } from './helpers.js';

/**
 * A bare app with just the M365 router mounted (integration forced-enabled).
 * `heorthErrorHandler` is mounted explicitly because this app is NOT built via
 * `createApp` — without it, a thrown `MaintenanceAdminError` would surface as
 * an unhandled 500 rather than the documented 403.
 */
function enabledApp() {
  const app = new Hono();
  app.route('/api/v1/m365', m365Router);
  app.onError(heorthErrorHandler);
  return app;
}

afterEach(() => setM365Runtime(null));

describe('m365 routes (enabled)', () => {
  it('GET /connect requires auth', async () => {
    setM365Runtime(runtimeForFakeGraph(createFakeGraph()));
    const res = await enabledApp().request('/api/v1/m365/connect');
    expect(res.status).toBe(401);
  });

  it('GET /connect redirects to the Microsoft authorize URL', async () => {
    setM365Runtime(runtimeForFakeGraph(createFakeGraph()));
    const { adult } = await seedTestHousehold();
    const res = await enabledApp().request('/api/v1/m365/connect', { headers: authHeaders(adult.jwt) });
    expect(res.status).toBe(302);
    const loc = res.headers.get('location')!;
    expect(loc).toContain('/oauth2/v2.0/authorize');
    expect(loc).toContain('client_id=test-client-id');
    expect(loc).toContain('state=');
  });

  it('GET /callback exchanges the code and stores an encrypted connection', async () => {
    setM365Runtime(runtimeForFakeGraph(createFakeGraph()));
    const { adult } = await seedTestHousehold();
    const state = await signConnectState(adult.user.id);
    const res = await enabledApp().request(`/api/v1/m365/callback?code=abc&state=${encodeURIComponent(state)}`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/profile?connected=m365');

    const [row] = await db.select().from(m365Connections).where(eq(m365Connections.memberId, adult.user.id));
    expect(row!.accountUpn).toBe('member@contoso.test');
    expect(row!.refreshTokenEncrypted).not.toContain('refresh-initial');
  });

  it('GET /callback rejects an invalid state', async () => {
    setM365Runtime(runtimeForFakeGraph(createFakeGraph()));
    const res = await enabledApp().request('/api/v1/m365/callback?code=abc&state=tampered');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/profile?connectError=M365_STATE_INVALID');
  });

  it('GET /status returns the acting member connection; admin sees all connections', async () => {
    setM365Runtime(runtimeForFakeGraph(createFakeGraph()));
    const { admin, adult } = await seedTestHousehold();
    const state = await signConnectState(adult.user.id);
    await enabledApp().request(`/api/v1/m365/callback?code=abc&state=${encodeURIComponent(state)}`);

    const mine = await enabledApp().request('/api/v1/m365/status', { headers: authHeaders(adult.jwt) });
    const mineBody = await mine.json() as { data: { connection: { accountUpn: string } | null } };
    expect(mineBody.data.connection!.accountUpn).toBe('member@contoso.test');

    const all = await enabledApp().request('/api/v1/m365/status', { headers: authHeaders(admin.jwt) });
    const allBody = await all.json() as { data: { connections: unknown[] } };
    expect(allBody.data.connections).toHaveLength(1);
  });

  it('GET /status exposes every feed status to a non-admin session (household-visible staleness, Finding 2)', async () => {
    const rt = runtimeForFakeGraph(createFakeGraph());
    setM365Runtime(rt);
    const { admin, adult, child } = await seedTestHousehold();

    // Sync state for a feed the acting member (adult) does not own — the
    // child's calendar feed, gone dead — must still show up for a non-admin.
    await rt.store.recordSyncFailure(feedKeys.calendarMember(child.user.id), 'graph_401');
    await rt.store.recordSyncSuccess(feedKeys.calendarFamily(), null);

    const res = await enabledApp().request('/api/v1/m365/status', { headers: authHeaders(adult.jwt) });
    const body = await res.json() as { data: { connection: unknown; feeds: { feedKey: string }[] } };
    const feedKeysSeen = body.data.feeds.map((f) => f.feedKey);
    expect(feedKeysSeen).toContain(feedKeys.calendarMember(child.user.id));
    expect(feedKeysSeen).toContain(feedKeys.calendarFamily());

    // Same feeds[] set for the admin — feeds[] doesn't vary by role, only
    // `connection`/`connections` (member-private) does.
    const adminRes = await enabledApp().request('/api/v1/m365/status', { headers: authHeaders(admin.jwt) });
    const adminBody = await adminRes.json() as { data: { feeds: { feedKey: string }[] } };
    expect(adminBody.data.feeds.map((f) => f.feedKey).sort()).toEqual(feedKeysSeen.sort());

    // Connection stays member-scoped for the non-admin session: adult has no
    // connection of their own here, so it must be null, not the child's or
    // a household-wide list.
    const body2 = body as { data: { connection: unknown } };
    expect(body2.data.connection).toBeNull();
    expect('connections' in body.data).toBe(false);
  });

  it('DELETE /connection disconnects the acting member', async () => {
    setM365Runtime(runtimeForFakeGraph(createFakeGraph()));
    const { adult } = await seedTestHousehold();
    const state = await signConnectState(adult.user.id);
    await enabledApp().request(`/api/v1/m365/callback?code=abc&state=${encodeURIComponent(state)}`);

    const del = await enabledApp().request('/api/v1/m365/connection', {
      method: 'DELETE', headers: authHeaders(adult.jwt),
    });
    expect(del.status).toBe(200);

    const del2 = await enabledApp().request('/api/v1/m365/connection', {
      method: 'DELETE', headers: authHeaders(adult.jwt),
    });
    expect(del2.status).toBe(404);
  });
});

describe('GET /connect-url', () => {
  it('requires auth', async () => {
    setM365Runtime(runtimeForFakeGraph(createFakeGraph()));
    const res = await enabledApp().request('/api/v1/m365/connect-url');
    expect(res.status).toBe(401);
  });

  it('returns the Microsoft authorize URL as JSON', async () => {
    setM365Runtime(runtimeForFakeGraph(createFakeGraph()));
    const { adult } = await seedTestHousehold();
    const res = await enabledApp().request('/api/v1/m365/connect-url', {
      headers: authHeaders(adult.jwt),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.url).toContain('/oauth2/v2.0/authorize');
    expect(data.url).toContain('state=');
  });

  it('refuses the maintenance admin', async () => {
    setM365Runtime(runtimeForFakeGraph(createFakeGraph()));
    const { admin } = await seedTestHousehold();
    const res = await enabledApp().request('/api/v1/m365/connect-url', {
      headers: authHeaders(admin.jwt),
    });
    expect(res.status).toBe(403);
  });
});

describe('callback redirects', () => {
  it('redirects to /profile on success', async () => {
    setM365Runtime(runtimeForFakeGraph(createFakeGraph()));
    const { adult } = await seedTestHousehold();
    const state = await signConnectState(adult.user.id);
    const res = await enabledApp().request(`/api/v1/m365/callback?code=abc&state=${state}`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/profile?connected=m365');
  });

  it('redirects to /profile with a code when consent is denied', async () => {
    setM365Runtime(runtimeForFakeGraph(createFakeGraph()));
    const res = await enabledApp().request('/api/v1/m365/callback?error=access_denied');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/profile?connectError=M365_CONSENT_DENIED');
  });

  it('redirects with M365_STATE_INVALID for a bad state', async () => {
    setM365Runtime(runtimeForFakeGraph(createFakeGraph()));
    const res = await enabledApp().request('/api/v1/m365/callback?code=c&state=not-a-jwt');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/profile?connectError=M365_STATE_INVALID');
  });

  it('redirects with M365_CALLBACK_INVALID when code or state is missing', async () => {
    setM365Runtime(runtimeForFakeGraph(createFakeGraph()));
    const res = await enabledApp().request('/api/v1/m365/callback');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/profile?connectError=M365_CALLBACK_INVALID');
  });
});

describe('m365 routes (disabled)', () => {
  it('does not mount any m365 routes — paths fall through to 404', async () => {
    // The test env sets no M365_* vars, so ALL_MODULES registers m365 as a no-op.
    const app = createApp(ALL_MODULES);
    const status = await app.request('/api/v1/m365/status');
    expect(status.status).toBe(404);
    const connect = await app.request('/api/v1/m365/connect');
    expect(connect.status).toBe(404);
  });
});

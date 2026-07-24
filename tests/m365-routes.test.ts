import { describe, it, expect, afterEach } from 'vitest';
import { Hono } from 'hono';
import { createApp } from '../src/app.js';
import { ALL_MODULES } from '../src/modules/index.js';
import { m365Router } from '../src/m365/routes.js';
import { setM365Runtime } from '../src/m365/runtime.js';
import { signConnectState } from '../src/m365/state.js';
import { eq } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { m365Connections } from '../src/m365/schema.js';
import { createFakeGraph, runtimeForFakeGraph } from './fake-graph.js';
import { seedTestHousehold, authHeaders } from './helpers.js';

/** A bare app with just the M365 router mounted (integration forced-enabled). */
function enabledApp() {
  const app = new Hono();
  app.route('/api/v1/m365', m365Router);
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
    expect(res.headers.get('location')).toBe('/?m365=connected');

    const [row] = await db.select().from(m365Connections).where(eq(m365Connections.memberId, adult.user.id));
    expect(row!.accountUpn).toBe('member@contoso.test');
    expect(row!.refreshTokenEncrypted).not.toContain('refresh-initial');
  });

  it('GET /callback rejects an invalid state', async () => {
    setM365Runtime(runtimeForFakeGraph(createFakeGraph()));
    const res = await enabledApp().request('/api/v1/m365/callback?code=abc&state=tampered');
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('M365_STATE_INVALID');
  });

  it('GET /status returns the acting member connection; admin sees all', async () => {
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

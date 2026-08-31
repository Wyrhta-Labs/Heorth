import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { seedTestHousehold, authHeaders } from './helpers.js';
import { heorthErrorHandler } from '../src/app.js';
import { integrationsRouter } from '../src/integrations/routes.js';
import { clearProviders, listProviders, registerProvider } from '../src/integrations/registry.js';
import { IntegrationStore } from '../src/integrations/store.js';
import { createFakeGoogle, runtimeForFakeGoogle, type FakeGoogle } from './fake-google.js';
import { GoogleCalendarProvider } from '../src/google/calendar-provider.js';
import { GoogleTaskProvider } from '../src/google/task-provider.js';
import { classify, googleFullResyncIntervalMs } from '../src/google/sync-runner.js';
import { runGoogleCalendarSync } from '../src/google/calendar-sync.js';
import { runGoogleTaskSync } from '../src/google/task-sync.js';
import type { GoogleRuntime } from '../src/google/runtime.js';

let fake: FakeGoogle;
let rt: GoogleRuntime;

/**
 * Register Google the way `googleModule.register()` does, but from an injected
 * fake-backed runtime — the module itself is a no-op under the suite because
 * `tests/setup.ts` blanks the GOOGLE_* group.
 */
function registerGoogleWithFake(runtime: GoogleRuntime): void {
  registerProvider({
    id: 'google',
    store: runtime.store,
    classifyError: classify,
    fullResyncIntervalMs: googleFullResyncIntervalMs(),
    authorizeUrl: (state) => runtime.oauth.authorizeUrl(state),
    completeConnect: async (code) => {
      const { refreshToken, accessToken, scopes } = await runtime.oauth.exchangeCode(code);
      return { accountLabel: await runtime.oauth.getUserEmail(accessToken), refreshToken, scopes };
    },
    calendar: new GoogleCalendarProvider(runtime),
    tasks: new GoogleTaskProvider(runtime),
    runCalendarSync: () => runGoogleCalendarSync(runtime),
    runTaskSync: () => runGoogleTaskSync(runtime),
  });
}

/**
 * A bare app with just the integrations router — copied verbatim from
 * `tests/integrations-routes.test.ts`, including the explicit error handler
 * (this app is NOT built via `createApp`, so without it a thrown
 * MaintenanceAdminError would surface as an unhandled 500).
 */
function app() {
  const a = new Hono();
  a.route('/api/v1/integrations', integrationsRouter);
  a.onError(heorthErrorHandler);
  return a;
}

beforeEach(() => {
  clearProviders();
  fake = createFakeGoogle();
  rt = runtimeForFakeGoogle(fake);
});
afterEach(() => { clearProviders(); });

describe('the google module', () => {
  it('registers no provider when the GOOGLE_* group is absent', async () => {
    const { googleModule } = await import('../src/google/index.js');
    googleModule.register(new Hono());
    expect(listProviders()).toEqual([]);
  });
});

describe('/api/v1/integrations/google', () => {
  it('404s the connect route when Google is not registered', async () => {
    const { adult } = await seedTestHousehold();
    const res = await app().request('/api/v1/integrations/google/connect-url', { headers: authHeaders(adult.jwt) });
    expect(res.status).toBe(404);
  });

  it('returns a consent URL carrying offline access when registered', async () => {
    const { adult } = await seedTestHousehold();
    registerGoogleWithFake(rt);
    const res = await app().request('/api/v1/integrations/google/connect-url', { headers: authHeaders(adult.jwt) });
    expect(res.status).toBe(200);
    const { data } = await res.json() as { data: { url: string } };
    const url = new URL(data.url);
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
  });

  it('stores a connection labelled with the Google account email on callback', async () => {
    const { adult } = await seedTestHousehold();
    registerGoogleWithFake(rt);
    fake.userEmail = 'anna@gmail.test';

    const urlRes = await app().request('/api/v1/integrations/google/connect-url', { headers: authHeaders(adult.jwt) });
    const state = new URL((await urlRes.json() as { data: { url: string } }).data.url).searchParams.get('state')!;

    const cb = await app().request(`/api/v1/integrations/google/callback?code=abc&state=${encodeURIComponent(state)}`);
    expect(cb.status).toBe(302);
    expect(cb.headers.get('location')).toBe('/profile?connected=google');
    expect((await rt.store.getConnection(adult.user.id))!.accountLabel).toBe('anna@gmail.test');
  });

  it('reports GOOGLE_NO_REFRESH_TOKEN specifically, not a generic failure', async () => {
    const { adult } = await seedTestHousehold();
    registerGoogleWithFake(rt);
    fake.omitRefreshToken = true;

    const urlRes = await app().request('/api/v1/integrations/google/connect-url', { headers: authHeaders(adult.jwt) });
    const state = new URL((await urlRes.json() as { data: { url: string } }).data.url).searchParams.get('state')!;

    const cb = await app().request(`/api/v1/integrations/google/callback?code=abc&state=${encodeURIComponent(state)}`);
    expect(cb.status).toBe(302);
    // The spec names this code. A generic GOOGLE_EXCHANGE_FAILED here would
    // send the member round the consent loop again with no idea why.
    expect(cb.headers.get('location')).toBe('/profile?connectError=GOOGLE_NO_REFRESH_TOKEN');
    expect(await rt.store.getConnection(adult.user.id)).toBeNull();
  });

  it('lists google among the providers on /status', async () => {
    const { adult } = await seedTestHousehold();
    registerGoogleWithFake(rt);
    const res = await app().request('/api/v1/integrations/status', { headers: authHeaders(adult.jwt) });
    const { data } = await res.json() as { data: { providers: string[] } };
    expect(data.providers).toContain('google');
  });
});

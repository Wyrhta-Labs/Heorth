import { Hono } from 'hono';
import type { M365Config } from '../src/config/env.js';
import { createM365Runtime, type M365Runtime } from '../src/m365/index.js';
import { DELEGATED_SCOPES } from '../src/m365/delegated.js';

/**
 * In-process fake of the Microsoft identity platform (token endpoint) + Graph,
 * mirroring the fake-Feoh pattern. Our M365 clients take an injectable `fetch`;
 * `runtimeForFakeGraph` wires a real store + these fake endpoints so tests never
 * touch a real tenant. Routes by URL pathname only (host is ignored), so the
 * single app serves both `login.microsoftonline.com` and `graph.microsoft.com`.
 */

export interface FakeGraphCall {
  method: string;
  path: string;
  grantType?: string;
}

export interface FakeGraph {
  app: Hono;
  calls: FakeGraphCall[];
  /** Number of refresh_token grants served (rotation counter). */
  refreshCount: number;
  /** Number of client_credentials grants served. */
  appTokenCount: number;
  /** When true, the next Graph call returns 429 once (then succeeds). */
  throttleNextGraph: boolean;
  /** When true, refresh_token grants return 400 invalid_grant. */
  failRefresh: boolean;
  /** UPN returned by GET /me. */
  meUpn: string;
}

const TEST_CONFIG: M365Config = {
  tenantId: 'test-tenant-id',
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  redirectUri: 'http://localhost:4000/api/v1/m365/callback',
  familyMailbox: 'family-calendar@contoso.test',
  sharedTodoList: 'Household',
};

export function createFakeGraph(): FakeGraph {
  const state: FakeGraph = {
    app: new Hono(),
    calls: [],
    refreshCount: 0,
    appTokenCount: 0,
    throttleNextGraph: false,
    failRefresh: false,
    meUpn: 'member@contoso.test',
  };

  // Identity: token endpoint (authorization_code / refresh_token / client_credentials).
  state.app.post('/:tenant/oauth2/v2.0/token', async (c) => {
    const form = await c.req.parseBody();
    const grantType = String(form['grant_type'] ?? '');
    state.calls.push({ method: 'POST', path: new URL(c.req.url).pathname, grantType });

    if (grantType === 'authorization_code') {
      return c.json({
        token_type: 'Bearer', expires_in: 3600, scope: DELEGATED_SCOPES,
        access_token: 'delegated-access-initial', refresh_token: 'refresh-initial',
      });
    }
    if (grantType === 'refresh_token') {
      if (state.failRefresh) {
        return c.json({ error: 'invalid_grant', error_description: 'refresh token expired' }, 400);
      }
      state.refreshCount += 1;
      return c.json({
        token_type: 'Bearer', expires_in: 3600, scope: DELEGATED_SCOPES,
        access_token: `delegated-access-r${state.refreshCount}`,
        refresh_token: `refresh-r${state.refreshCount}`,
      });
    }
    if (grantType === 'client_credentials') {
      state.appTokenCount += 1;
      return c.json({ token_type: 'Bearer', expires_in: 3600, access_token: `app-access-${state.appTokenCount}` });
    }
    return c.json({ error: 'unsupported_grant_type' }, 400);
  });

  // Graph: /me (used to record the account UPN + as a 429-retry probe target).
  state.app.get('/v1.0/me', (c) => {
    state.calls.push({ method: 'GET', path: '/v1.0/me' });
    if (state.throttleNextGraph) {
      state.throttleNextGraph = false;
      return c.json({ error: { code: 'TooManyRequests', message: 'throttled' } }, 429, { 'Retry-After': '0' });
    }
    return c.json({ id: 'user-object-id', userPrincipalName: state.meUpn, displayName: 'Test User' });
  });

  // Graph: a shared-mailbox user probe (mirrors the smoke script's app-only check).
  state.app.get('/v1.0/users/:mailbox', (c) => {
    state.calls.push({ method: 'GET', path: new URL(c.req.url).pathname });
    return c.json({ id: 'mailbox-object-id', userPrincipalName: c.req.param('mailbox'), displayName: 'Family Calendar' });
  });

  return state;
}

/** Build an M365Runtime whose clients talk to the in-process fake over its fetch. */
export function runtimeForFakeGraph(fake: FakeGraph): M365Runtime {
  const fakeFetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    fake.app.request(input as string, init)) as typeof fetch;
  return createM365Runtime(TEST_CONFIG, fakeFetch);
}

export { TEST_CONFIG as fakeM365Config };

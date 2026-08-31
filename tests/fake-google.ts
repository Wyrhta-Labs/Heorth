import { Hono } from 'hono';
import type { GoogleConfig } from '../src/config/env.js';
import { createGoogleRuntime, type GoogleRuntime } from '../src/google/runtime.js';
import { GOOGLE_SCOPES } from '../src/google/oauth.js';

/**
 * In-process fake of Google's identity platform and APIs, the sibling of
 * `tests/fake-graph.ts`. Our Google clients take an injectable `fetch`;
 * `runtimeForFakeGoogle` wires a real store + these fake endpoints so tests
 * never touch a real Google project. Routed by pathname only, so one app serves
 * accounts.google.com, oauth2.googleapis.com, www.googleapis.com and
 * tasks.googleapis.com at once.
 */

export interface FakeGoogleCall {
  method: string;
  path: string;
  grantType?: string;
  /** Raw query string (no leading `?`) — lets tests assert a fresh window
   *  (`timeMin=`) vs. a replayed token (`syncToken=`). */
  query?: string;
  body?: unknown;
}

export interface FakeGoogle {
  app: Hono;
  calls: FakeGoogleCall[];
  /** Number of refresh_token grants served (rotation counter). */
  refreshCount: number;
  /** When true, the authorization_code exchange omits refresh_token. */
  omitRefreshToken: boolean;
  /** When true, refresh_token grants return 400 invalid_grant. */
  failRefresh: boolean;
  /** Email returned by the userinfo endpoint. */
  userEmail: string;
}

const TEST_CONFIG: GoogleConfig = {
  clientId: 'test-google-client-id',
  clientSecret: 'test-google-client-secret',
  redirectUri: 'http://localhost:4000/api/v1/integrations/google/callback',
};

export function createFakeGoogle(): FakeGoogle {
  const state: FakeGoogle = {
    app: new Hono(),
    calls: [],
    refreshCount: 0,
    omitRefreshToken: false,
    failRefresh: false,
    userEmail: 'member@gmail.test',
  };

  // Token endpoint (authorization_code / refresh_token).
  state.app.post('/token', async (c) => {
    const form = await c.req.parseBody();
    const grantType = String(form['grant_type'] ?? '');
    state.calls.push({ method: 'POST', path: '/token', grantType });

    if (grantType === 'authorization_code') {
      return c.json({
        token_type: 'Bearer',
        expires_in: 3599,
        scope: GOOGLE_SCOPES,
        access_token: 'google-access-initial',
        ...(state.omitRefreshToken ? {} : { refresh_token: 'google-refresh-initial' }),
      });
    }
    if (grantType === 'refresh_token') {
      if (state.failRefresh) {
        return c.json({ error: 'invalid_grant', error_description: 'expired or revoked' }, 400);
      }
      state.refreshCount += 1;
      // Google does NOT rotate refresh tokens on refresh — the response carries
      // an access token only. The client must keep the stored one.
      return c.json({
        token_type: 'Bearer',
        expires_in: 3599,
        scope: GOOGLE_SCOPES,
        access_token: `google-access-r${state.refreshCount}`,
      });
    }
    return c.json({ error: 'unsupported_grant_type' }, 400);
  });

  // Userinfo — the account label. Routed by pathname, so this matches the
  // canonical https://openidconnect.googleapis.com/v1/userinfo.
  state.app.get('/v1/userinfo', (c) => {
    state.calls.push({ method: 'GET', path: '/v1/userinfo' });
    return c.json({ sub: 'google-user-id', email: state.userEmail, email_verified: true });
  });

  return state;
}

/** Build a GoogleRuntime whose clients talk to the in-process fake over its fetch. */
export function runtimeForFakeGoogle(fake: FakeGoogle): GoogleRuntime {
  const fakeFetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    fake.app.request(input as string, init)) as typeof fetch;
  return createGoogleRuntime(TEST_CONFIG, fakeFetch);
}

export { TEST_CONFIG as fakeGoogleConfig };

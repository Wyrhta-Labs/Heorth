import { describe, it, expect, beforeEach } from 'vitest';
import { seedTestHousehold } from './helpers.js';
import { createFakeGoogle, runtimeForFakeGoogle, type FakeGoogle } from './fake-google.js';
import { GoogleNoRefreshTokenError, GOOGLE_SCOPES } from '../src/google/oauth.js';
import { classify } from '../src/google/sync-runner.js';
import type { GoogleRuntime } from '../src/google/runtime.js';

let fake: FakeGoogle;
let rt: GoogleRuntime;

beforeEach(() => {
  fake = createFakeGoogle();
  rt = runtimeForFakeGoogle(fake);
});

describe('GoogleOAuthClient.authorizeUrl', () => {
  it('always carries access_type=offline and prompt=consent', () => {
    const url = new URL(rt.oauth.authorizeUrl('state-token'));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBe('state-token');
    expect(url.searchParams.get('scope')).toBe(GOOGLE_SCOPES);
  });
});

describe('GoogleOAuthClient.exchangeCode', () => {
  it('returns the refresh token and granted scopes', async () => {
    const out = await rt.oauth.exchangeCode('auth-code');
    expect(out.refreshToken).toBe('google-refresh-initial');
    expect(out.accessToken).toBe('google-access-initial');
    expect(out.scopes).toBe(GOOGLE_SCOPES);
  });

  it('FAILS LOUDLY when Google issues no refresh token', async () => {
    fake.omitRefreshToken = true;
    await expect(rt.oauth.exchangeCode('auth-code')).rejects.toBeInstanceOf(GoogleNoRefreshTokenError);
  });
});

describe('GoogleOAuthClient.getAccessToken', () => {
  it('refreshes from the stored token and KEEPS it (Google does not rotate)', async () => {
    const { adult } = await seedTestHousehold();
    await rt.store.upsertConnection({
      memberId: adult.user.id, accountLabel: 'a@gmail.test',
      refreshToken: 'stored-refresh', scopes: GOOGLE_SCOPES,
    });
    const token = await rt.oauth.getAccessToken(adult.user.id);
    expect(token).toBe('google-access-r1');
    expect(await rt.store.getRefreshToken(adult.user.id)).toBe('stored-refresh');
  });

  it('caches the access token for the member', async () => {
    const { adult } = await seedTestHousehold();
    await rt.store.upsertConnection({
      memberId: adult.user.id, accountLabel: 'a@gmail.test',
      refreshToken: 'stored-refresh', scopes: GOOGLE_SCOPES,
    });
    await rt.oauth.getAccessToken(adult.user.id);
    await rt.oauth.getAccessToken(adult.user.id);
    expect(fake.refreshCount).toBe(1);
  });

  it('marks the connection needs_reauth AND classifies the throw the same way', async () => {
    const { adult } = await seedTestHousehold();
    await rt.store.upsertConnection({
      memberId: adult.user.id, accountLabel: 'a@gmail.test',
      refreshToken: 'stored-refresh', scopes: GOOGLE_SCOPES,
    });
    fake.failRefresh = true;

    const e = await rt.oauth.getAccessToken(adult.user.id).catch((err: unknown) => err);

    expect((await rt.store.getConnection(adult.user.id))!.status).toBe('needs_reauth');
    // Google says `400 invalid_grant` for a revoked refresh token. If that 400
    // escapes raw, `classify` calls it `google_400` and the row's
    // `needs_reauth` and the surfaced reason disagree.
    expect(classify(e)).toBe('needs_reauth');
  });

  it('reports no_connection when the member has never connected', async () => {
    const { child } = await seedTestHousehold();
    const e = await rt.oauth.getAccessToken(child.user.id).catch((err: unknown) => err);
    expect((e as { reason?: string }).reason).toBe('no_connection');
  });
});

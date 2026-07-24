import { describe, it, expect } from 'vitest';
import { GraphError } from '../src/m365/graph.js';
import { createFakeGraph, runtimeForFakeGraph } from './fake-graph.js';
import { seedTestHousehold } from './helpers.js';

describe('m365 delegated client', () => {
  it('exchanges an auth code and resolves the account via /me', async () => {
    const fake = createFakeGraph();
    const rt = runtimeForFakeGraph(fake);
    const { refreshToken, accessToken, scopes } = await rt.delegated.exchangeCode('the-code');
    expect(refreshToken).toBe('refresh-initial');
    expect(scopes).toContain('offline_access');
    const me = await rt.delegated.getMe(accessToken);
    expect(me.userPrincipalName).toBe('member@contoso.test');
  });

  it('refreshes on demand, persists rotated refresh tokens, and caches the access token', async () => {
    const fake = createFakeGraph();
    const rt = runtimeForFakeGraph(fake);
    const { adult } = await seedTestHousehold();
    await rt.store.upsertConnection({
      memberId: adult.user.id, accountUpn: 'adult@contoso.test', refreshToken: 'refresh-initial', scopes: '',
    });

    // First call refreshes → rotates the stored refresh token to refresh-r1.
    const t1 = await rt.delegated.getAccessToken(adult.user.id);
    expect(t1).toBe('delegated-access-r1');
    expect(fake.refreshCount).toBe(1);
    expect(await rt.store.getRefreshToken(adult.user.id)).toBe('refresh-r1');

    // Second call hits the in-memory cache (no new refresh grant).
    const t2 = await rt.delegated.getAccessToken(adult.user.id);
    expect(t2).toBe('delegated-access-r1');
    expect(fake.refreshCount).toBe(1);

    // After dropping the cache, it refreshes again and re-rotates.
    rt.delegated.clearCache();
    const t3 = await rt.delegated.getAccessToken(adult.user.id);
    expect(t3).toBe('delegated-access-r2');
    expect(fake.refreshCount).toBe(2);
    expect(await rt.store.getRefreshToken(adult.user.id)).toBe('refresh-r2');
  });

  it('marks the connection needs_reauth when the refresh token is rejected', async () => {
    const fake = createFakeGraph();
    fake.failRefresh = true;
    const rt = runtimeForFakeGraph(fake);
    const { adult } = await seedTestHousehold();
    await rt.store.upsertConnection({
      memberId: adult.user.id, accountUpn: 'adult@contoso.test', refreshToken: 'refresh-initial', scopes: '',
    });

    await expect(rt.delegated.getAccessToken(adult.user.id)).rejects.toBeInstanceOf(GraphError);
    const conn = await rt.store.getConnection(adult.user.id);
    expect(conn!.status).toBe('needs_reauth');
    expect(conn!.lastRefreshError).toBeTruthy();
  });
});

describe('m365 app-only client', () => {
  it('caches the app-only token (second call hits the cache)', async () => {
    const fake = createFakeGraph();
    const rt = runtimeForFakeGraph(fake);
    const a = await rt.appOnly.getAccessToken();
    const b = await rt.appOnly.getAccessToken();
    expect(a).toBe('app-access-1');
    expect(b).toBe('app-access-1');
    expect(fake.appTokenCount).toBe(1);
  });
});

describe('m365 graphFetch', () => {
  it('retries once on 429 and then succeeds', async () => {
    const fake = createFakeGraph();
    fake.throttleNextGraph = true;
    const rt = runtimeForFakeGraph(fake);
    const me = await rt.graphFetch<{ userPrincipalName: string }>('access-token', '/me');
    expect(me.userPrincipalName).toBe('member@contoso.test');
    // Two hits: the throttled 429, then the successful retry.
    expect(fake.calls.filter((c) => c.path === '/v1.0/me')).toHaveLength(2);
  });

  it('maps a non-2xx response to a typed GraphError', async () => {
    const fake = createFakeGraph();
    const rt = runtimeForFakeGraph(fake);
    // /v1.0/me is fine; hit an unknown path to force a 404 from Hono.
    await expect(rt.graphFetch('token', '/does-not-exist')).rejects.toBeInstanceOf(GraphError);
  });
});

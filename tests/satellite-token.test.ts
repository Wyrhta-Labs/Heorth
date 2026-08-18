import { describe, it, expect, afterEach } from 'vitest';
import { webcrypto } from 'node:crypto';
import { loadPublicKey, verifyToken } from '@wyrhta/core/identity';
import { decode } from 'hono/jwt';
import { createApp } from '../src/app.js';
import { householdModule } from '../src/household/index.js';
import { loadSatelliteKeys, setSatelliteKeys } from '../src/satellite/keys.js';
import { setSatelliteAudiences, SATELLITE_TOKEN_TTL_SECONDS } from '../src/satellite/token.js';
import { identity } from '../src/wiring.js';
import { seedTestHousehold } from './helpers.js';

/**
 * Satellite token exchange (B3, ADR 0009):
 * `POST /api/v1/auth/satellite-token`.
 *
 * The guarantees under test are all about a credential-minting endpoint:
 * nothing is minted without a credential, nothing is minted for an audience
 * nobody registered, what IS minted verifies against the PUBLISHED JWKS, and
 * it carries the caller's own identity and nothing more.
 *
 * Key material is generated per test — a committed private key, even a
 * throwaway one, is the exact thing this feature exists to keep out of repos.
 */

const app = createApp([householdModule]);

const AUDIENCE = 'kithledger';
const KID = 'sat-test-1';

type Jwks = { keys: Array<Record<string, unknown>> };

async function generatePrivatePem(): Promise<string> {
  const pair = (await webcrypto.subtle.generateKey({ name: 'Ed25519' } as never, true, [
    'sign',
    'verify',
  ])) as webcrypto.CryptoKeyPair;
  const der = await webcrypto.subtle.exportKey('pkcs8', pair.privateKey);
  const b64 = Buffer.from(der).toString('base64').replace(/(.{64})/g, '$1\n').trim();
  return `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----`;
}

/** Configure the deployment: one active signing key + one known audience. */
async function configure(audiences: readonly string[] = [AUDIENCE]): Promise<void> {
  setSatelliteKeys(
    await loadSatelliteKeys({
      active: { material: await generatePrivatePem(), kid: KID, alg: 'EdDSA' },
      secondary: null,
    }),
  );
  setSatelliteAudiences(audiences);
}

/**
 * Exchange through the real app. Each call gets its own source IP so the
 * per-IP rate limiter (shared module state within this file) cannot make one
 * test depend on another; the limiter itself is exercised deliberately below.
 */
let ipCounter = 0;
async function exchange(
  credential: string | null,
  body: unknown,
): Promise<{ status: number; raw: string; json: any }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-forwarded-for': `10.0.0.${++ipCounter % 250}${ipCounter}`,
  };
  if (credential) headers['Authorization'] = `Bearer ${credential}`;
  const res = await app.request('/api/v1/auth/satellite-token', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  return { status: res.status, raw, json: raw ? JSON.parse(raw) : null };
}

/** The public key as a satellite would obtain it: from the published JWKS. */
async function publicKeyFromPublishedJwks() {
  const res = await app.request('/.well-known/jwks.json');
  const jwks = (await res.json()) as Jwks;
  const jwk = jwks.keys.find((k) => k['kid'] === KID);
  expect(jwk).toBeTruthy();
  return loadPublicKey(jwk as webcrypto.JsonWebKey, { kid: KID, alg: 'EdDSA' });
}

afterEach(() => {
  setSatelliteKeys(null);
  setSatelliteAudiences(null);
});

describe('satellite token exchange — refusals', () => {
  it('refuses a request with no credential before minting anything', async () => {
    await configure();
    const { status, raw } = await exchange(null, { audience: AUDIENCE });
    expect(status).toBe(401);
    // Nothing that could be a token came back.
    expect(raw).not.toContain('token');
  });

  it('refuses an unknown audience rather than minting optimistically', async () => {
    await configure();
    const { admin } = await seedTestHousehold();
    const { status, json } = await exchange(admin.jwt, { audience: 'not-a-satellite' });
    expect(status).toBe(400);
    expect(json.error.code).toBe('UNKNOWN_AUDIENCE');
    expect(json).not.toHaveProperty('data');
  });

  it('refuses every audience when none is registered (the default deployment)', async () => {
    await configure([]);
    const { admin } = await seedTestHousehold();
    const { status, json } = await exchange(admin.jwt, { audience: AUDIENCE });
    expect(status).toBe(400);
    expect(json.error.code).toBe('UNKNOWN_AUDIENCE');
  });

  it('fails cleanly with a domain code when no signing key is configured', async () => {
    // Audience registered, but no key: the one case where a naive
    // implementation might reach for JWT_SECRET. It must refuse instead.
    setSatelliteKeys({ signingKey: null, publicKeys: [] });
    setSatelliteAudiences([AUDIENCE]);
    const { admin } = await seedTestHousehold();
    const { status, json } = await exchange(admin.jwt, { audience: AUDIENCE });
    expect(status).toBe(503);
    expect(json.error.code).toBe('SATELLITE_SIGNING_UNAVAILABLE');
    expect(json).not.toHaveProperty('data');
  });

  it('rejects a body with no audience', async () => {
    await configure();
    const { admin } = await seedTestHousehold();
    const { status, json } = await exchange(admin.jwt, {});
    expect(status).toBe(400);
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('satellite token exchange — the minted token', () => {
  it('verifies against the PUBLISHED JWKS, end to end', async () => {
    await configure();
    const { adult } = await seedTestHousehold();

    const { status, json } = await exchange(adult.jwt, { audience: AUDIENCE });
    expect(status).toBe(200);
    expect(json.data.expires_in).toBe(SATELLITE_TOKEN_TTL_SECONDS);
    expect(json.data.audience).toBe(AUDIENCE);

    // Exactly what a satellite does: fetch the public key set, pick by kid,
    // verify. Nothing shared but the public document.
    const publicKey = await publicKeyFromPublishedJwks();
    const claims = await verifyToken(json.data.token, publicKey, {
      iss: 'heorth',
      aud: AUDIENCE,
      leewaySeconds: 60,
    });
    expect(claims.sub).toBe(adult.user.id);
    expect(claims.role).toBe('adult');
    expect(claims.iss).toBe('heorth');
    expect(claims.aud).toBe(AUDIENCE);
    expect(claims.exp! - claims.iat!).toBe(SATELLITE_TOKEN_TTL_SECONDS);
  });

  it('is a 5-minute token and says so without the caller parsing it', async () => {
    await configure();
    const { admin } = await seedTestHousehold();
    const { json } = await exchange(admin.jwt, { audience: AUDIENCE });
    const now = Math.floor(Date.now() / 1000);
    const claims = (await verifyToken(json.data.token, await publicKeyFromPublishedJwks(), {
      leewaySeconds: 60,
    })) as { exp: number };
    expect(json.data.expires_in).toBe(300);
    expect(claims.exp - now).toBeLessThanOrEqual(300);
    expect(claims.exp - now).toBeGreaterThan(290);
  });

  it('is NOT signed with JWT_SECRET (the key that also encrypts M365 refresh tokens)', async () => {
    await configure();
    const { admin } = await seedTestHousehold();
    const { json } = await exchange(admin.jwt, { audience: AUDIENCE });

    const secret = process.env['JWT_SECRET'];
    expect(secret).toBeTruthy();
    await expect(verifyToken(json.data.token, secret!, 'HS256')).rejects.toThrow();
    // And it announces the asymmetric key it WAS signed with.
    const header = decode(json.data.token).header as { alg?: string; kid?: string };
    expect(header.alg).toBe('EdDSA');
    expect(header.kid).toBe(KID);
  });

  it('works for an `he_` API key exactly as for a member JWT', async () => {
    await configure();
    const { adult } = await seedTestHousehold();
    const key = await identity.createApiKey(adult.user.id, 'mcp');

    const { status, json } = await exchange(key.key, { audience: AUDIENCE });
    expect(status).toBe(200);
    const claims = await verifyToken(json.data.token, await publicKeyFromPublishedJwks(), {
      aud: AUDIENCE,
      leewaySeconds: 60,
    });
    // The `he_` key holder's OWN member identity — that is the whole point of
    // the exchange for an MCP caller.
    expect(claims.sub).toBe(adult.user.id);
    expect(claims.role).toBe('adult');
  });
});

describe('satellite token exchange — the token grants no more than its bearer had', () => {
  it('takes sub/role from the principal, never from the request body', async () => {
    await configure();
    const { admin, child } = await seedTestHousehold();

    // A child caller trying to mint an admin's identity.
    const { status, json } = await exchange(child.jwt, {
      audience: AUDIENCE,
      sub: admin.user.id,
      role: 'admin',
      userId: admin.user.id,
    });
    expect(status).toBe(200);
    const claims = await verifyToken(json.data.token, await publicKeyFromPublishedJwks(), {
      leewaySeconds: 60,
    });
    expect(claims.sub).toBe(child.user.id);
    expect(claims.sub).not.toBe(admin.user.id);
    expect(claims.role).toBe('child');
  });

  it('does not elevate a child — the exchanged token stays a child token', async () => {
    await configure();
    const { child } = await seedTestHousehold();
    const { status, json } = await exchange(child.jwt, { audience: AUDIENCE });
    expect(status).toBe(200);
    const claims = await verifyToken(json.data.token, await publicKeyFromPublishedJwks(), {
      leewaySeconds: 60,
    });
    expect(claims.role).toBe('child');
  });

  it('binds the token to ONE audience', async () => {
    await configure([AUDIENCE, 'heimr']);
    const { admin } = await seedTestHousehold();
    const { json } = await exchange(admin.jwt, { audience: 'heimr' });
    const publicKey = await publicKeyFromPublishedJwks();

    await expect(
      verifyToken(json.data.token, publicKey, { aud: AUDIENCE, leewaySeconds: 60 }),
    ).rejects.toThrow('INVALID_AUDIENCE');
    await expect(
      verifyToken(json.data.token, publicKey, { aud: 'heimr', leewaySeconds: 60 }),
    ).resolves.toBeTruthy();
  });
});

describe('satellite token exchange — nothing secret leaks', () => {
  it('returns the token, its lifetime and its audience — and no key material', async () => {
    await configure();
    const { admin } = await seedTestHousehold();
    const { raw, json } = await exchange(admin.jwt, { audience: AUDIENCE });

    expect(Object.keys(json.data).sort()).toEqual(['audience', 'expires_in', 'token']);
    // JWT_SECRET stays inside Heorth; no private JWK member is anywhere in the
    // response either.
    const secret = process.env['JWT_SECRET'];
    expect(raw).not.toContain(secret!);
    expect(raw).not.toContain('PRIVATE');
    expect(raw).not.toMatch(/"d"\s*:/);

    // Nor in the token payload itself.
    const payload = decode(json.data.token).payload as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(['aud', 'exp', 'iat', 'iss', 'role', 'sub']);
  });
});

describe('satellite token exchange — rate limiting', () => {
  it('rate-limits the endpoint, in front of the auth guard', async () => {
    await configure();
    // One fixed IP for this test only: the limiter is per-IP, so this cannot
    // spend any other test's budget.
    const headers = {
      'Content-Type': 'application/json',
      'x-forwarded-for': '198.51.100.7',
    };
    const hit = () =>
      app.request('/api/v1/auth/satellite-token', {
        method: 'POST',
        headers,
        body: JSON.stringify({ audience: AUDIENCE }),
      });

    let last = 0;
    for (let i = 0; i < 60; i++) last = (await hit()).status;
    // Unauthenticated throughout — proving the limiter runs BEFORE requireAuth
    // and that hammering the endpoint without a credential is capped.
    expect(last).toBe(401);
    const limited = await hit();
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBeTruthy();
  });
});

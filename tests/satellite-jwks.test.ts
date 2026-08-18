import { describe, it, expect, afterEach } from 'vitest';
import { webcrypto } from 'node:crypto';
import { signToken, verifyToken, loadPublicKey } from '@wyrhta/core/identity';
import { createApp } from '../src/app.js';
import {
  loadSatelliteKeys,
  setSatelliteKeys,
  getSatelliteJwks,
} from '../src/satellite/keys.js';
import type { SatelliteConfig } from '../src/config/env.js';

/**
 * Satellite identity JWKS (B1c). Everything here is about ONE guarantee: the
 * document Heorth publishes is public, complete, and carries nothing but
 * public key material.
 *
 * Key material is generated per test rather than checked in — a committed
 * private key, even a throwaway one, is exactly the thing this feature exists
 * to keep out of repositories.
 */

type Jwks = { keys: Array<Record<string, unknown>> };

/** Generate a key pair and return its PKCS#8 PEM / SPKI PEM pair. */
async function generatePem(alg: 'EdDSA' | 'RS256'): Promise<{ privatePem: string; publicPem: string }> {
  const params =
    alg === 'EdDSA'
      ? { name: 'Ed25519' }
      : {
          name: 'RSASSA-PKCS1-v1_5',
          modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: 'SHA-256',
        };
  const pair = (await webcrypto.subtle.generateKey(params as never, true, [
    'sign',
    'verify',
  ])) as webcrypto.CryptoKeyPair;
  const wrap = (label: string, der: ArrayBuffer): string => {
    const b64 = Buffer.from(der).toString('base64').replace(/(.{64})/g, '$1\n').trim();
    return `-----BEGIN ${label}-----\n${b64}\n-----END ${label}-----`;
  };
  return {
    privatePem: wrap('PRIVATE KEY', await webcrypto.subtle.exportKey('pkcs8', pair.privateKey)),
    publicPem: wrap('PUBLIC KEY', await webcrypto.subtle.exportKey('spki', pair.publicKey)),
  };
}

/** Install a key set built from an explicit config, as the env would produce. */
async function install(cfg: SatelliteConfig): Promise<void> {
  setSatelliteKeys(await loadSatelliteKeys(cfg));
}

/** Fetch the JWKS through the real app, with NO credentials. */
async function fetchJwks(): Promise<{ status: number; body: Jwks; cacheControl: string | null }> {
  const app = createApp([]);
  const res = await app.request('/.well-known/jwks.json');
  return {
    status: res.status,
    body: (await res.json()) as Jwks,
    cacheControl: res.headers.get('cache-control'),
  };
}

afterEach(() => setSatelliteKeys(null));

describe('satellite JWKS endpoint', () => {
  it('is unauthenticated and publishes the configured key', async () => {
    const { privatePem } = await generatePem('EdDSA');
    await install({
      active: { material: privatePem, kid: 'sat-2026-08', alg: 'EdDSA' },
      secondary: null,
    });

    // No Authorization header anywhere — a satellite must be able to fetch this
    // with no credentials at all. That is the point of a public key set.
    const { status, body, cacheControl } = await fetchJwks();
    expect(status).toBe(200);
    expect(body.keys).toHaveLength(1);
    expect(cacheControl).toBe('public, max-age=300');

    const [key] = body.keys;
    expect(key).toMatchObject({ kty: 'OKP', crv: 'Ed25519', alg: 'EdDSA', kid: 'sat-2026-08', use: 'sig' });
    expect(key!['x']).toBeTypeOf('string');
  });

  it('is a bare JWKS document, not the ok() envelope', async () => {
    const { privatePem } = await generatePem('EdDSA');
    await install({ active: { material: privatePem, kid: 'k1', alg: 'EdDSA' }, secondary: null });

    const { body } = await fetchJwks();
    // Generic JWKS clients read `keys` off the top level; a `data` wrapper
    // would break every one of them.
    expect(Object.keys(body)).toEqual(['keys']);
    expect(body).not.toHaveProperty('data');
  });

  it('publishes an empty key set when nothing is configured', async () => {
    // The default deployment: no SATELLITE_* env at all. The endpoint must
    // report "no keys published" rather than crash or 404.
    setSatelliteKeys({ signingKey: null, publicKeys: [] });
    const { status, body } = await fetchJwks();
    expect(status).toBe(200);
    expect(body).toEqual({ keys: [] });
  });

  it('supports RS256 as well as EdDSA', async () => {
    const { privatePem } = await generatePem('RS256');
    await install({ active: { material: privatePem, kid: 'rsa-1', alg: 'RS256' }, secondary: null });

    const { body } = await fetchJwks();
    expect(body.keys[0]).toMatchObject({ kty: 'RSA', alg: 'RS256', kid: 'rsa-1', use: 'sig' });
    expect(body.keys[0]!['n']).toBeTypeOf('string');
  });

  it('accepts a JWK JSON string and a newline-escaped PEM as key material', async () => {
    const { privatePem } = await generatePem('EdDSA');
    // A single-line .env cannot hold real newlines; the escaped form must work.
    await install({
      active: { material: privatePem.replace(/\n/g, '\\n'), kid: 'escaped', alg: 'EdDSA' },
      secondary: null,
    });
    expect((await fetchJwks()).body.keys[0]).toMatchObject({ kid: 'escaped' });
  });
});

describe('satellite JWKS exposes public material only', () => {
  /** Every JWK member that is (part of) a private key. */
  const PRIVATE_MEMBERS = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'];

  it('never emits a private component for EdDSA', async () => {
    const { privatePem } = await generatePem('EdDSA');
    await install({ active: { material: privatePem, kid: 'k1', alg: 'EdDSA' }, secondary: null });

    const { body } = await fetchJwks();
    for (const key of body.keys) {
      for (const member of PRIVATE_MEMBERS) expect(key).not.toHaveProperty(member);
      expect(Object.keys(key).sort()).toEqual(['alg', 'crv', 'kid', 'kty', 'use', 'x']);
    }
  });

  it('never emits a private component for RS256', async () => {
    const { privatePem } = await generatePem('RS256');
    await install({ active: { material: privatePem, kid: 'rsa-1', alg: 'RS256' }, secondary: null });

    const { body } = await fetchJwks();
    // An RSA private JWK carries d/p/q/dp/dq/qi; the published one must be
    // exactly the public pair plus metadata.
    for (const member of PRIVATE_MEMBERS) expect(body.keys[0]).not.toHaveProperty(member);
    expect(Object.keys(body.keys[0]!).sort()).toEqual(['alg', 'e', 'kid', 'kty', 'n', 'use']);
  });

  it('leaks neither the private key material nor JWT_SECRET into the response body', async () => {
    const { privatePem } = await generatePem('EdDSA');
    await install({ active: { material: privatePem, kid: 'k1', alg: 'EdDSA' }, secondary: null });

    const app = createApp([]);
    const raw = await (await app.request('/.well-known/jwks.json')).text();

    // JWT_SECRET stays inside Heorth — it signs member logins AND derives the
    // M365 refresh-token encryption key (src/m365/crypto.ts).
    const jwtSecret = process.env['JWT_SECRET'];
    expect(jwtSecret).toBeTruthy();
    expect(raw).not.toContain(jwtSecret!);

    // No fragment of the private PEM, and no private JWK member name.
    const pemBody = privatePem.replace(/-+(BEGIN|END)[^-]*-+/g, '').replace(/\s+/g, '');
    expect(raw).not.toContain(pemBody);
    expect(raw).not.toContain('PRIVATE');
    expect(raw).not.toMatch(/"d"\s*:/);
  });

  it('holds the signing key in memory but never publishes it', async () => {
    const { privatePem } = await generatePem('EdDSA');
    await install({ active: { material: privatePem, kid: 'k1', alg: 'EdDSA' }, secondary: null });

    const jwks = await getSatelliteJwks();
    expect(jwks.keys[0]).not.toHaveProperty('d');
  });
});

describe('satellite JWKS multi-key rotation', () => {
  it('publishes both keys with distinct kids, signing only with the active one', async () => {
    const outgoing = await generatePem('EdDSA');
    const incoming = await generatePem('EdDSA');
    await install({
      active: { material: incoming.privatePem, kid: 'sat-2026-09', alg: 'EdDSA' },
      secondary: { material: outgoing.privatePem, kid: 'sat-2026-08', alg: 'EdDSA' },
    });

    const { body } = await fetchJwks();
    expect(body.keys).toHaveLength(2);
    const kids = body.keys.map((k) => k['kid']);
    expect(kids).toEqual(['sat-2026-09', 'sat-2026-08']);
    expect(new Set(kids).size).toBe(2);
    for (const key of body.keys) expect(key).not.toHaveProperty('d');

    // A satellite fetching this document can verify a freshly signed token
    // against the whole published set, selecting by kid.
    const published = await Promise.all(
      body.keys.map((k) => loadPublicKey(k as webcrypto.JsonWebKey, {
        kid: k['kid'] as string,
        alg: k['alg'] as 'EdDSA',
      })),
    );
    const keys = await loadSatelliteKeys({
      active: { material: incoming.privatePem, kid: 'sat-2026-09', alg: 'EdDSA' },
      secondary: { material: outgoing.privatePem, kid: 'sat-2026-08', alg: 'EdDSA' },
    });
    const token = await signToken({ sub: 'u1', role: 'adult' }, keys.signingKey!, 60);
    const claims = await verifyToken(token, published);
    expect(claims.sub).toBe('u1');
  });

  it('accepts PUBLIC-only material in the overlap slot, so retired private keys can be deleted', async () => {
    const active = await generatePem('EdDSA');
    const retiring = await generatePem('EdDSA');
    await install({
      active: { material: active.privatePem, kid: 'new', alg: 'EdDSA' },
      // Only the public half of the outgoing key is still on the host.
      secondary: { material: retiring.publicPem, kid: 'old', alg: 'EdDSA' },
    });

    const { body } = await fetchJwks();
    expect(body.keys.map((k) => k['kid'])).toEqual(['new', 'old']);
    for (const key of body.keys) expect(key).not.toHaveProperty('d');
  });

  it('mixes algorithms across the overlap (EdDSA active, RS256 retiring)', async () => {
    const active = await generatePem('EdDSA');
    const retiring = await generatePem('RS256');
    await install({
      active: { material: active.privatePem, kid: 'ed-new', alg: 'EdDSA' },
      secondary: { material: retiring.publicPem, kid: 'rsa-old', alg: 'RS256' },
    });

    const { body } = await fetchJwks();
    expect(body.keys.map((k) => [k['kid'], k['alg']])).toEqual([
      ['ed-new', 'EdDSA'],
      ['rsa-old', 'RS256'],
    ]);
  });

  it('rejects two keys sharing a kid (verification would be ambiguous)', async () => {
    const a = await generatePem('EdDSA');
    const b = await generatePem('EdDSA');
    await expect(
      loadSatelliteKeys({
        active: { material: a.privatePem, kid: 'same', alg: 'EdDSA' },
        secondary: { material: b.publicPem, kid: 'same', alg: 'EdDSA' },
      }),
    ).rejects.toThrow('DUPLICATE_KEY_ID');
  });

  it('rejects unreadable key material with core\'s INVALID_KEY_MATERIAL', async () => {
    await expect(
      loadSatelliteKeys({
        active: { material: 'not-a-key', kid: 'k1', alg: 'EdDSA' },
        secondary: null,
      }),
    ).rejects.toThrow('INVALID_KEY_MATERIAL');
  });

  it('refuses a PUBLIC key in the ACTIVE slot — the signer must be able to sign', async () => {
    const { publicPem } = await generatePem('EdDSA');
    await expect(
      loadSatelliteKeys({
        active: { material: publicPem, kid: 'k1', alg: 'EdDSA' },
        secondary: null,
      }),
    ).rejects.toThrow('INVALID_KEY_MATERIAL');
  });

  it('loads nothing when the config is absent', async () => {
    const keys = await loadSatelliteKeys(null);
    expect(keys).toEqual({ signingKey: null, publicKeys: [] });
  });
});

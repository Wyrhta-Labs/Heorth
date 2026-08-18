import { describe, it, expect } from 'vitest';
import { buildEnvSchema } from '../src/config/env.js';

/**
 * The SATELLITE_* signing-key group (B1c). Same all-or-nothing contract as
 * M365_* / KITH_*: absent is the default and must leave Heorth behaving
 * exactly as before; partial presence is a startup error.
 */
describe('satellite signing key env group', () => {
  const base = {
    DATABASE_URL: 'postgres://u:p@localhost:5432/db',
    JWT_SECRET: 'x'.repeat(32),
    HOUSEHOLD_NAME: 'Home',
    ADMIN_EMAIL: 'a@b.com',
    ADMIN_PASSWORD: 'pw',
  };

  const activeGroup = {
    SATELLITE_SIGNING_KEY: '{"kty":"OKP","crv":"Ed25519","x":"aaa","d":"bbb"}',
    SATELLITE_SIGNING_KID: 'sat-2026-08',
  };

  it('is valid with no SATELLITE vars (feature disabled — the default)', () => {
    const parsed = buildEnvSchema().safeParse(base);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.SATELLITE_SIGNING_KEY).toBeUndefined();
  });

  it('is valid with the active group present', () => {
    expect(buildEnvSchema().safeParse({ ...base, ...activeGroup }).success).toBe(true);
  });

  it('rejects a key without a kid (all-or-nothing)', () => {
    const parsed = buildEnvSchema().safeParse({
      ...base,
      SATELLITE_SIGNING_KEY: activeGroup.SATELLITE_SIGNING_KEY,
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a kid without a key (all-or-nothing)', () => {
    const parsed = buildEnvSchema().safeParse({ ...base, SATELLITE_SIGNING_KID: 'sat-2026-08' });
    expect(parsed.success).toBe(false);
  });

  it('treats empty strings as absent (group stays cleanly disabled)', () => {
    const parsed = buildEnvSchema().safeParse({
      ...base,
      SATELLITE_SIGNING_KEY: '',
      SATELLITE_SIGNING_KID: '',
      SATELLITE_SIGNING_ALG: '',
    });
    expect(parsed.success).toBe(true);
  });

  it('defaults the algorithm to EdDSA when the group omits it', () => {
    const parsed = buildEnvSchema().parse({ ...base, ...activeGroup });
    expect(parsed.SATELLITE_SIGNING_ALG).toBeUndefined();
  });

  it('accepts both supported algorithms and rejects anything else', () => {
    for (const alg of ['EdDSA', 'RS256']) {
      expect(
        buildEnvSchema().safeParse({ ...base, ...activeGroup, SATELLITE_SIGNING_ALG: alg }).success,
      ).toBe(true);
    }
    expect(
      buildEnvSchema().safeParse({ ...base, ...activeGroup, SATELLITE_SIGNING_ALG: 'HS256' }).success,
    ).toBe(false);
    expect(
      buildEnvSchema().safeParse({ ...base, ...activeGroup, SATELLITE_SIGNING_ALG: 'ES256' }).success,
    ).toBe(false);
  });

  it('rejects an algorithm set without any key (an orphan knob)', () => {
    const parsed = buildEnvSchema().safeParse({ ...base, SATELLITE_SIGNING_ALG: 'EdDSA' });
    expect(parsed.success).toBe(false);
  });

  describe('rotation-overlap (secondary) slot', () => {
    const secondaryGroup = {
      SATELLITE_SIGNING_KEY_SECONDARY: '{"kty":"OKP","crv":"Ed25519","x":"ccc"}',
      SATELLITE_SIGNING_KID_SECONDARY: 'sat-2026-07',
    };

    it('is valid alongside the active group', () => {
      expect(
        buildEnvSchema().safeParse({ ...base, ...activeGroup, ...secondaryGroup }).success,
      ).toBe(true);
    });

    it('is itself all-or-nothing', () => {
      const parsed = buildEnvSchema().safeParse({
        ...base,
        ...activeGroup,
        SATELLITE_SIGNING_KEY_SECONDARY: secondaryGroup.SATELLITE_SIGNING_KEY_SECONDARY,
      });
      expect(parsed.success).toBe(false);
    });

    it('is rejected without an active key — a JWKS of only retired keys is meaningless', () => {
      const parsed = buildEnvSchema().safeParse({ ...base, ...secondaryGroup });
      expect(parsed.success).toBe(false);
    });

    it('accepts its own algorithm, so an overlap can mix EdDSA and RS256', () => {
      const parsed = buildEnvSchema().safeParse({
        ...base,
        ...activeGroup,
        ...secondaryGroup,
        SATELLITE_SIGNING_ALG: 'EdDSA',
        SATELLITE_SIGNING_ALG_SECONDARY: 'RS256',
      });
      expect(parsed.success).toBe(true);
    });
  });

  describe('SATELLITE_AUDIENCES (the known-satellite allowlist, B3)', () => {
    it('defaults to absent — no satellite is trusted until one is named', () => {
      const parsed = buildEnvSchema().parse({ ...base, ...activeGroup });
      expect(parsed.SATELLITE_AUDIENCES).toBeUndefined();
    });

    it('parses a comma-separated list, trimming whitespace', () => {
      const parsed = buildEnvSchema().parse({
        ...base,
        ...activeGroup,
        SATELLITE_AUDIENCES: 'kithledger, heimr',
      });
      expect(parsed.SATELLITE_AUDIENCES).toEqual(['kithledger', 'heimr']);
    });

    it('rejects entries that are not lowercase slugs', () => {
      for (const value of ['KithLedger', 'kith ledger', 'kith_ledger', 'https://kith']) {
        expect(
          buildEnvSchema().safeParse({ ...base, ...activeGroup, SATELLITE_AUDIENCES: value }).success,
        ).toBe(false);
      }
    });

    it('rejects duplicates', () => {
      expect(
        buildEnvSchema().safeParse({
          ...base,
          ...activeGroup,
          SATELLITE_AUDIENCES: 'kithledger,kithledger',
        }).success,
      ).toBe(false);
    });

    it('is rejected without an active signing key — nothing could sign for it', () => {
      expect(
        buildEnvSchema().safeParse({ ...base, SATELLITE_AUDIENCES: 'kithledger' }).success,
      ).toBe(false);
    });

    it('treats an empty value as absent', () => {
      const parsed = buildEnvSchema().safeParse({ ...base, SATELLITE_AUDIENCES: '' });
      expect(parsed.success).toBe(true);
    });
  });

  it('leaves JWT_SECRET and every other var untouched', () => {
    // The satellite key is SEPARATE: JWT_SECRET still signs member logins and
    // still derives the M365 refresh-token encryption key.
    const parsed = buildEnvSchema().parse({ ...base, ...activeGroup });
    expect(parsed.JWT_SECRET).toBe(base.JWT_SECRET);
    expect(parsed.JWT_TTL_SECONDS).toBe(604800);
  });
});

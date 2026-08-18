import { describe, it, expect } from 'vitest';
import { buildEnvSchema } from '../src/config/env.js';

describe('kith env group', () => {
  const base = {
    DATABASE_URL: 'postgres://u:p@localhost:5432/db',
    JWT_SECRET: 'x'.repeat(32),
    HOUSEHOLD_NAME: 'Home',
    ADMIN_EMAIL: 'a@b.com',
    ADMIN_PASSWORD: 'pw',
  };

  const fullKith = {
    KITH_BASE_URL: 'http://localhost:4100',
    KITH_API_KEY: 'kl_test-key',
  };

  it('is valid with no KITH vars (integration disabled)', () => {
    expect(buildEnvSchema().safeParse(base).success).toBe(true);
  });

  it('is valid with the full KITH group present', () => {
    expect(buildEnvSchema().safeParse({ ...base, ...fullKith }).success).toBe(true);
  });

  it('rejects partial KITH config (all-or-nothing)', () => {
    const parsed = buildEnvSchema().safeParse({ ...base, KITH_BASE_URL: fullKith.KITH_BASE_URL });
    expect(parsed.success).toBe(false);
  });

  it('rejects a key without a base URL', () => {
    const parsed = buildEnvSchema().safeParse({ ...base, KITH_API_KEY: fullKith.KITH_API_KEY });
    expect(parsed.success).toBe(false);
  });

  it('treats empty strings as absent (group stays cleanly disabled)', () => {
    const parsed = buildEnvSchema().safeParse({ ...base, KITH_BASE_URL: '', KITH_API_KEY: '' });
    expect(parsed.success).toBe(true);
  });

  it('rejects a non-URL base URL', () => {
    const parsed = buildEnvSchema().safeParse({ ...base, ...fullKith, KITH_BASE_URL: 'not-a-url' });
    expect(parsed.success).toBe(false);
  });
});

/**
 * ADR 0004 §2 / task B8 — the key's ROLE is declared, not implied. Heorth
 * cannot introspect a `kl_` key's kind (they all look alike, and KithLedger's
 * key listing needs a local-account JWT Heorth does not hold), so the schema
 * pins the declaration to the only kind this integration may present.
 */
describe('KITH_API_KEY_KIND (the credential\'s declared role)', () => {
  const base = {
    DATABASE_URL: 'postgres://u:p@localhost:5432/db',
    JWT_SECRET: 'x'.repeat(32),
    HOUSEHOLD_NAME: 'Home',
    ADMIN_EMAIL: 'a@b.com',
    ADMIN_PASSWORD: 'pw',
    KITH_BASE_URL: 'http://localhost:4100',
    KITH_API_KEY: 'kl_test-key',
  };

  it('defaults to household when unset (an existing .env keeps working)', () => {
    const parsed = buildEnvSchema().safeParse(base);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.KITH_API_KEY_KIND).toBeUndefined();
  });

  it('accepts an explicit household declaration', () => {
    expect(buildEnvSchema().safeParse({ ...base, KITH_API_KEY_KIND: 'household' }).success).toBe(true);
  });

  it.each(['member', 'ops'] as const)('rejects a %s key with the migration procedure', (kind) => {
    const parsed = buildEnvSchema().safeParse({ ...base, KITH_API_KEY_KIND: kind });
    expect(parsed.success).toBe(false);
    const message = parsed.success ? '' : JSON.stringify(parsed.error.issues);
    expect(message).toContain("must be 'household'");
    expect(message).toContain('/api/v1/auth/keys');
  });

  it('rejects an unknown kind', () => {
    expect(buildEnvSchema().safeParse({ ...base, KITH_API_KEY_KIND: 'dashboard' }).success).toBe(false);
  });

  it('rejects the kind without the group (orphaned declaration)', () => {
    const parsed = buildEnvSchema().safeParse({
      DATABASE_URL: base.DATABASE_URL, JWT_SECRET: base.JWT_SECRET,
      HOUSEHOLD_NAME: base.HOUSEHOLD_NAME, ADMIN_EMAIL: base.ADMIN_EMAIL,
      ADMIN_PASSWORD: base.ADMIN_PASSWORD,
      KITH_API_KEY_KIND: 'household',
    });
    expect(parsed.success).toBe(false);
  });

  it('treats an empty kind as absent (copying .env.example verbatim stays valid)', () => {
    expect(buildEnvSchema().safeParse({ ...base, KITH_API_KEY_KIND: '' }).success).toBe(true);
  });
});

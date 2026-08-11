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

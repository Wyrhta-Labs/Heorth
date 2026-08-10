import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Re-declare the schema shape under test by importing the builder.
// env.ts calls process.exit on failure, so we test the exported schema builder instead.
import { buildEnvSchema } from '../src/config/env.js';

describe('env schema', () => {
  const base = {
    DATABASE_URL: 'postgres://heorth:pw@localhost:5432/heorth',
    JWT_SECRET: 'x'.repeat(32),
    HOUSEHOLD_NAME: 'Our Home',
    ADMIN_EMAIL: 'admin@example.com',
    ADMIN_PASSWORD: 'secret',
  };

  it('accepts a valid environment', () => {
    const parsed = buildEnvSchema().safeParse(base);
    expect(parsed.success).toBe(true);
  });

  it('rejects a JWT_SECRET shorter than 32 chars', () => {
    const parsed = buildEnvSchema().safeParse({ ...base, JWT_SECRET: 'short' });
    expect(parsed.success).toBe(false);
  });

  it('rejects a missing HOUSEHOLD_NAME', () => {
    const { HOUSEHOLD_NAME, ...rest } = base;
    const parsed = buildEnvSchema().safeParse(rest);
    expect(parsed.success).toBe(false);
  });

  it('rejects an invalid ADMIN_EMAIL', () => {
    const parsed = buildEnvSchema().safeParse({ ...base, ADMIN_EMAIL: 'not-an-email' });
    expect(parsed.success).toBe(false);
  });
});

describe('library env vars', () => {
  const base = {
    DATABASE_URL: 'postgres://u:p@localhost:5432/db',
    JWT_SECRET: 'x'.repeat(32),
    HOUSEHOLD_NAME: 'Home',
    ADMIN_EMAIL: 'a@b.com',
    ADMIN_PASSWORD: 'pw',
  };

  it('accepts optional Trakt + encryption vars', () => {
    const parsed = buildEnvSchema().parse({
      ...base,
      TRAKT_CLIENT_ID: 'cid',
      TRAKT_CLIENT_SECRET: 'sec',
      LIBRARY_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    });
    expect(parsed.TRAKT_CLIENT_ID).toBe('cid');
    expect(parsed.LIBRARY_ENCRYPTION_KEY).toBeTypeOf('string');
  });

  it('is valid without any library vars set', () => {
    const parsed = buildEnvSchema().parse(base);
    expect(parsed.TRAKT_CLIENT_ID).toBeUndefined();
  });
});

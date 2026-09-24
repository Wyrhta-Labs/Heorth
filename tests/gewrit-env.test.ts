import { describe, it, expect } from 'vitest';
import { buildEnvSchema } from '../src/config/env.js';

describe('gewrit env group', () => {
  const base = {
    DATABASE_URL: 'postgres://u:p@localhost:5432/db',
    JWT_SECRET: 'x'.repeat(32),
    HOUSEHOLD_NAME: 'Home',
    ADMIN_EMAIL: 'a@b.com',
    ADMIN_PASSWORD: 'pw',
  };
  const paperless = {
    GEWRIT_PROVIDER: 'paperless',
    PAPERLESS_BASE_URL: 'http://paperless:8000',
    PAPERLESS_TOKEN: 'pl-token',
  };

  function messages(input: Record<string, string>): string {
    const r = buildEnvSchema().safeParse({ ...base, ...input });
    return r.success ? '' : r.error.issues.map((i) => i.message).join('\n');
  }

  it('is valid with no Gewrit vars (module off)', () => {
    expect(buildEnvSchema().safeParse(base).success).toBe(true);
  });

  it('is valid with the full paperless group', () => {
    expect(buildEnvSchema().safeParse({ ...base, ...paperless }).success).toBe(true);
  });

  it('keeps all four variables in the parsed output (the half check-env-template.mjs cannot see)', () => {
    const r = buildEnvSchema().safeParse({ ...base, ...paperless, PAPERLESS_PUBLIC_URL: 'https://paperless.home' });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data).toMatchObject({
      GEWRIT_PROVIDER: 'paperless',
      PAPERLESS_BASE_URL: 'http://paperless:8000',
      PAPERLESS_TOKEN: 'pl-token',
      PAPERLESS_PUBLIC_URL: 'https://paperless.home',
    });
  });

  it('names the missing token', () => {
    const m = messages({ GEWRIT_PROVIDER: 'paperless', PAPERLESS_BASE_URL: 'http://paperless:8000' });
    expect(m).toContain('PAPERLESS_TOKEN');
    expect(m).not.toContain('PAPERLESS_BASE_URL and');
  });

  it('names both when both are missing', () => {
    const m = messages({ GEWRIT_PROVIDER: 'paperless' });
    expect(m).toContain('PAPERLESS_BASE_URL and PAPERLESS_TOKEN');
  });

  it('treats blank values as missing', () => {
    const m = messages({ GEWRIT_PROVIDER: 'paperless', PAPERLESS_BASE_URL: '', PAPERLESS_TOKEN: '' });
    expect(m).toContain('PAPERLESS_BASE_URL and PAPERLESS_TOKEN');
  });

  it('accepts the fake provider without any PAPERLESS_* value', () => {
    expect(buildEnvSchema().safeParse({ ...base, GEWRIT_PROVIDER: 'fake' }).success).toBe(true);
  });

  it('accepts PAPERLESS_* while the provider is blank (compose passes defaults)', () => {
    const r = buildEnvSchema().safeParse({ ...base, GEWRIT_PROVIDER: '', PAPERLESS_BASE_URL: 'http://paperless:8000', PAPERLESS_TOKEN: 't' });
    expect(r.success).toBe(true);
  });

  it('rejects an unknown provider', () => {
    expect(buildEnvSchema().safeParse({ ...base, GEWRIT_PROVIDER: 'nextcloud' }).success).toBe(false);
  });
});

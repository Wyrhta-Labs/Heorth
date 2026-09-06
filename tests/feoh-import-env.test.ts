import { describe, it, expect } from 'vitest';
import { buildEnvSchema } from '../src/config/env.js';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  JWT_SECRET: 'x'.repeat(32),
  HOUSEHOLD_NAME: 'Home',
  ADMIN_EMAIL: 'a@b.com',
  ADMIN_PASSWORD: 'pw',
};

describe('feoh import env group', () => {
  it('is valid with nothing set — import disabled, currency defaults to EUR', () => {
    const parsed = buildEnvSchema().safeParse(base);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.FEOH_IMPORT_ENABLED).toBeUndefined();
      expect(parsed.data.FEOH_CURRENCY).toBeUndefined();
    }
  });

  it('treats blank FEOH_IMPORT_ENABLED as disabled', () => {
    expect(buildEnvSchema().safeParse({ ...base, FEOH_IMPORT_ENABLED: '' }).success).toBe(true);
  });

  it('allows FIREFLY_* to be present while disabled (compose passes defaults)', () => {
    expect(buildEnvSchema().safeParse({
      ...base, FEOH_IMPORT_ENABLED: 'false', FIREFLY_BASE_URL: 'http://firefly:8080', FIREFLY_PAT: '',
    }).success).toBe(true);
  });

  it('is valid when enabled with both FIREFLY vars', () => {
    expect(buildEnvSchema().safeParse({
      ...base, FEOH_IMPORT_ENABLED: 'true', FIREFLY_BASE_URL: 'http://firefly:8080', FIREFLY_PAT: 'eyJ.x.y',
    }).success).toBe(true);
  });

  it('rejects enabled without a PAT', () => {
    const parsed = buildEnvSchema().safeParse({
      ...base, FEOH_IMPORT_ENABLED: 'true', FIREFLY_BASE_URL: 'http://firefly:8080',
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0]!.message).toContain('FIREFLY_PAT');
  });

  it('rejects enabled without a base URL', () => {
    expect(buildEnvSchema().safeParse({ ...base, FEOH_IMPORT_ENABLED: 'true', FIREFLY_PAT: 'x' }).success).toBe(false);
  });

  it('rejects a value other than true/false', () => {
    expect(buildEnvSchema().safeParse({ ...base, FEOH_IMPORT_ENABLED: 'yes' }).success).toBe(false);
  });

  it('rejects a non-ISO currency and accepts a valid one', () => {
    expect(buildEnvSchema().safeParse({ ...base, FEOH_CURRENCY: 'euro' }).success).toBe(false);
    const ok = buildEnvSchema().safeParse({ ...base, FEOH_CURRENCY: 'CHF' });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.FEOH_CURRENCY).toBe('CHF');
  });
});

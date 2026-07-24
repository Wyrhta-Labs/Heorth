import { describe, it, expect } from 'vitest';
import { buildEnvSchema } from '../src/config/env.js';

describe('m365 env group', () => {
  const base = {
    DATABASE_URL: 'postgres://u:p@localhost:5432/db',
    JWT_SECRET: 'x'.repeat(32),
    HOUSEHOLD_NAME: 'Home',
    ADMIN_EMAIL: 'a@b.com',
    ADMIN_PASSWORD: 'pw',
    FEOH_BASE_URL: 'http://feoh.test',
    FEOH_API_KEY: 'fe_service-key',
  };

  const fullM365 = {
    M365_TENANT_ID: 'tenant',
    M365_CLIENT_ID: 'client',
    M365_CLIENT_SECRET: 'secret',
    M365_REDIRECT_URI: 'http://localhost:4000/api/v1/m365/callback',
    M365_FAMILY_MAILBOX: 'family@example.com',
    M365_SHARED_TODO_LIST: 'Household',
  };

  it('is valid with no M365 vars (integration disabled)', () => {
    expect(buildEnvSchema().safeParse(base).success).toBe(true);
  });

  it('is valid with the full M365 group present', () => {
    expect(buildEnvSchema().safeParse({ ...base, ...fullM365 }).success).toBe(true);
  });

  it('rejects partial M365 config (all-or-nothing)', () => {
    const { M365_CLIENT_SECRET, ...partial } = fullM365;
    const parsed = buildEnvSchema().safeParse({ ...base, ...partial });
    expect(parsed.success).toBe(false);
  });

  it('rejects a non-URL redirect URI', () => {
    const parsed = buildEnvSchema().safeParse({ ...base, ...fullM365, M365_REDIRECT_URI: 'not-a-url' });
    expect(parsed.success).toBe(false);
  });
});

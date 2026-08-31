import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const GOOGLE_KEYS = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI'] as const;

function clearGoogle(): void {
  for (const k of GOOGLE_KEYS) delete process.env[k];
}

async function loadConfig() {
  vi.resetModules();
  return (await import('../src/config/env.js')).config;
}

describe('GOOGLE_* env group', () => {
  beforeEach(() => { clearGoogle(); });
  afterEach(() => { clearGoogle(); vi.resetModules(); });

  it('is null when the whole group is absent', async () => {
    const config = await loadConfig();
    expect(config.google).toBeNull();
  });

  it('resolves when the whole group is present', async () => {
    process.env['GOOGLE_CLIENT_ID'] = 'client-id';
    process.env['GOOGLE_CLIENT_SECRET'] = 'client-secret';
    process.env['GOOGLE_REDIRECT_URI'] = 'http://localhost:4000/api/v1/integrations/google/callback';
    const config = await loadConfig();
    expect(config.google).toEqual({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      redirectUri: 'http://localhost:4000/api/v1/integrations/google/callback',
    });
  });

  it('refuses a partially configured group at startup', async () => {
    process.env['GOOGLE_CLIENT_ID'] = 'client-id';
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit');
    }) as never);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(loadConfig()).rejects.toThrow('process.exit');
    exit.mockRestore();
  });

  it('treats a blank value as absent, not as a validation error', async () => {
    for (const k of GOOGLE_KEYS) process.env[k] = '';
    const config = await loadConfig();
    expect(config.google).toBeNull();
  });
});

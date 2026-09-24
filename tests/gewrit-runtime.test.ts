// Same fresh-graph pattern as tests/kith-gating.test.ts: env.ts reads
// process.env once at load, so each env state needs vi.resetModules().
import { describe, it, expect, vi, afterAll } from 'vitest';
import { createFakeDocuments } from './fake-documents.js';

const KEYS = ['GEWRIT_PROVIDER', 'PAPERLESS_BASE_URL', 'PAPERLESS_TOKEN', 'PAPERLESS_PUBLIC_URL'];
afterAll(() => { for (const k of KEYS) delete process.env[k]; });

async function freshRuntime(env: Record<string, string>) {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, env);
  vi.resetModules();
  return import('../src/modules/gewrit/runtime.js');
}

describe('gewrit runtime seam', () => {
  it('is disabled by default and refuses to build a provider', async () => {
    const rt = await freshRuntime({});
    expect(rt.isGewritEnabled()).toBe(false);
    expect(() => rt.getGewritRuntime()).toThrow(/disabled/);
  });

  it('builds the demo provider for GEWRIT_PROVIDER=fake', async () => {
    const rt = await freshRuntime({ GEWRIT_PROVIDER: 'fake' });
    expect(rt.isGewritEnabled()).toBe(true);
    expect(rt.getGewritRuntime().id).toBe('fake');
  });

  it('builds the Paperless provider without making a call', async () => {
    const rt = await freshRuntime({ GEWRIT_PROVIDER: 'paperless', PAPERLESS_BASE_URL: 'http://paperless.invalid', PAPERLESS_TOKEN: 't' });
    expect(rt.getGewritRuntime().id).toBe('paperless');
  });

  it('returns an installed fake until it is reset', async () => {
    const rt = await freshRuntime({ GEWRIT_PROVIDER: 'fake' });
    const fake = createFakeDocuments();
    rt.setGewritRuntime(fake);
    expect(rt.getGewritRuntime()).toBe(fake);
    rt.setGewritRuntime(null);
    expect(rt.getGewritRuntime().id).toBe('fake');
  });
});

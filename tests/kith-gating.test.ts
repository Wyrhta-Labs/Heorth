// The KITH_* env group gate. Same env-gated-config pattern as
// tests/feoh-gating.test.ts: `src/config/env.ts` reads process.env once at
// module-load time, so each state change goes through `vi.resetModules()` plus
// a fresh dynamic `import()` of src/app.js / src/modules/index.js after
// mutating the env. The fake runtime must be installed through the FRESH
// module graph's `setKithRuntime` (the routes resolve the singleton from that
// graph); `runtimeForFakeKith` itself is graph-agnostic (plain object).
import { describe, it, expect, vi, afterAll } from 'vitest';
import { seedTestHousehold, authHeaders } from './helpers.js';
import { createFakeKith, runtimeForFakeKith, reminder } from './fake-kith.js';

// singleFork shares process.env across test files — restore the ambient
// default (unset/disabled) so later files aren't affected by this one.
afterAll(() => {
  delete process.env['KITH_BASE_URL'];
  delete process.env['KITH_API_KEY'];
  delete process.env['KITH_API_KEY_KIND'];
});

async function freshApp() {
  vi.resetModules();
  const { createApp } = await import('../src/app.js');
  const { ALL_MODULES } = await import('../src/modules/index.js');
  const { setKithRuntime } = await import('../src/modules/kith/runtime.js');
  return { app: createApp(ALL_MODULES), setKithRuntime };
}

describe('kith module gating (KITH_* env group)', () => {
  describe('disabled (default test env)', () => {
    it('GET /api/v1/kith/reminders 404s via the catch-all envelope', async () => {
      delete process.env['KITH_BASE_URL'];
      delete process.env['KITH_API_KEY'];
  delete process.env['KITH_API_KEY_KIND'];
      const { app } = await freshApp();
      const { adult } = await seedTestHousehold();

      const res = await app.request(
        '/api/v1/kith/reminders?from=2026-08-01T00:00:00Z&to=2026-08-31T00:00:00Z',
        { headers: authHeaders(adult.jwt) },
      );
      expect(res.status).toBe(404);
      const body = await res.json() as { error: { code: string } };
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('GET /api/v1/features reports kithledger disabled', async () => {
      delete process.env['KITH_BASE_URL'];
      delete process.env['KITH_API_KEY'];
  delete process.env['KITH_API_KEY_KIND'];
      const { app } = await freshApp();
      const { adult } = await seedTestHousehold();
      const res = await app.request('/api/v1/features', { headers: authHeaders(adult.jwt) });
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { kithledger: boolean } };
      expect(body.data.kithledger).toBe(false);
    });
  });

  describe('enabled', () => {
    it('GET /api/v1/kith/reminders responds through the mounted module', async () => {
      process.env['KITH_BASE_URL'] = 'http://kith.test';
      process.env['KITH_API_KEY'] = 'kl_test-key';
      const { app, setKithRuntime } = await freshApp();
      const fake = createFakeKith([reminder({ id: 'r1', dueAt: '2026-08-15T09:00:00.000Z' })]);
      setKithRuntime(runtimeForFakeKith(fake));
      const { adult } = await seedTestHousehold();

      const res = await app.request(
        '/api/v1/kith/reminders?from=2026-08-01T00:00:00Z&to=2026-08-31T00:00:00Z',
        { headers: authHeaders(adult.jwt) },
      );
      expect(res.status).toBe(200);
      const body = await res.json() as { data: Array<{ id: string }> };
      expect(body.data.map((r) => r.id)).toEqual(['r1']);
      setKithRuntime(null);
    });

    it('GET /api/v1/features reports kithledger enabled', async () => {
      process.env['KITH_BASE_URL'] = 'http://kith.test';
      process.env['KITH_API_KEY'] = 'kl_test-key';
      const { app } = await freshApp();
      const { adult } = await seedTestHousehold();
      const res = await app.request('/api/v1/features', { headers: authHeaders(adult.jwt) });
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { finance: boolean; kithledger: boolean } };
      expect(body.data.kithledger).toBe(true);
      // the sibling flag is still reported (untouched by the kith group)
      expect(typeof body.data.finance).toBe('boolean');
    });
  });
});

import { describe, it, expect, afterEach } from 'vitest';
import { Hono } from 'hono';
import { heorthErrorHandler } from '../src/app.js';
import { kithRouter } from '../src/modules/kith/routes.js';
import { setKithRuntime, createKithRuntime } from '../src/modules/kith/runtime.js';
import { KithUnreachableError, KithClient } from '../src/modules/kith/client.js';
import { seedTestHousehold, authHeaders } from './helpers.js';
import { createFakeKith, runtimeForFakeKith, reminder } from './fake-kith.js';

/**
 * A bare app with just the kith router mounted (integration forced-enabled),
 * the same pattern as tests/m365-routes.test.ts. The runtime is always a
 * fake-KithLedger-backed one installed via setKithRuntime — never the network.
 */
function enabledApp() {
  const app = new Hono();
  app.route('/api/v1/kith', kithRouter);
  app.onError(heorthErrorHandler);
  return app;
}

const WINDOW = 'from=2026-08-10T00:00:00Z&to=2026-08-17T00:00:00Z';

afterEach(() => setKithRuntime(null));

describe('GET /api/v1/kith/reminders', () => {
  it('requires auth', async () => {
    setKithRuntime(runtimeForFakeKith(createFakeKith([])));
    const res = await enabledApp().request(`/api/v1/kith/reminders?${WINDOW}`);
    expect(res.status).toBe(401);
  });

  it('rejects missing or non-ISO from/to and from > to', async () => {
    setKithRuntime(runtimeForFakeKith(createFakeKith([])));
    const app = enabledApp();
    const { adult } = await seedTestHousehold();

    for (const qs of [
      '', 'from=2026-08-10T00:00:00Z', 'to=2026-08-17T00:00:00Z',
      'from=next-week&to=2026-08-17T00:00:00Z',
      'from=2026-08-18T00:00:00Z&to=2026-08-17T00:00:00Z',
    ]) {
      const res = await app.request(`/api/v1/kith/reminders?${qs}`, { headers: authHeaders(adult.jwt) });
      expect(res.status).toBe(400);
      const body = await res.json() as { error: { code: string } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('returns only reminders inside the window, fields passed through unchanged', async () => {
    const inWindow = reminder({
      id: 'in', dueAt: '2026-08-12T09:00:00.000Z', personId: 'person-7',
      title: 'Call grandma', notes: 'birthday soon', kind: 'birthday', leadDays: 7,
      recurrence: 'yearly',
    });
    const fake = createFakeKith([
      reminder({ id: 'before', dueAt: '2026-08-09T23:59:59.000Z' }), // below lower bound — Heorth-side filter
      inWindow,
      reminder({ id: 'after', dueAt: '2026-08-18T00:00:00.000Z' }),  // beyond due_before — upstream filter
      reminder({ id: 'done', dueAt: '2026-08-12T10:00:00.000Z', status: 'done' }),
      reminder({ id: 'dismissed', dueAt: '2026-08-12T11:00:00.000Z', status: 'dismissed' }),
    ]);
    setKithRuntime(runtimeForFakeKith(fake));
    const { adult } = await seedTestHousehold();

    const res = await enabledApp().request(`/api/v1/kith/reminders?${WINDOW}`, { headers: authHeaders(adult.jwt) });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<Record<string, unknown>> };
    expect(body.data).toEqual([inWindow]);
    // the service API key went upstream, and only upstream
    expect(fake.authHeaders.every((h) => h === 'Bearer kl_test-key')).toBe(true);
  });

  it('includes window edges (from and to are inclusive)', async () => {
    const fake = createFakeKith([
      reminder({ id: 'at-from', dueAt: '2026-08-10T00:00:00.000Z' }),
      reminder({ id: 'at-to', dueAt: '2026-08-17T00:00:00.000Z' }),
    ]);
    setKithRuntime(runtimeForFakeKith(fake));
    const { adult } = await seedTestHousehold();

    const res = await enabledApp().request(`/api/v1/kith/reminders?${WINDOW}`, { headers: authHeaders(adult.jwt) });
    const body = await res.json() as { data: Array<{ id: string }> };
    expect(body.data.map((r) => r.id)).toEqual(['at-from', 'at-to']);
  });

  it('uses snoozedUntil as the effective due for snoozed reminders', async () => {
    const fake = createFakeKith([
      // dueAt below the window but snoozed into it → included, ordered by snooze end
      reminder({
        id: 'snoozed-in', dueAt: '2026-08-01T09:00:00.000Z', status: 'snoozed',
        snoozedUntil: '2026-08-14T09:00:00.000Z',
      }),
      // dueAt inside the window but snoozed past `to` → excluded
      reminder({
        id: 'snoozed-out', dueAt: '2026-08-12T09:00:00.000Z', status: 'snoozed',
        snoozedUntil: '2026-08-20T09:00:00.000Z',
      }),
      // snoozed without a snoozedUntil → falls back to dueAt
      reminder({ id: 'snoozed-null', dueAt: '2026-08-11T09:00:00.000Z', status: 'snoozed' }),
      reminder({ id: 'pending-mid', dueAt: '2026-08-13T09:00:00.000Z' }),
    ]);
    setKithRuntime(runtimeForFakeKith(fake));
    const { adult } = await seedTestHousehold();

    const res = await enabledApp().request(`/api/v1/kith/reminders?${WINDOW}`, { headers: authHeaders(adult.jwt) });
    const body = await res.json() as { data: Array<{ id: string }> };
    // sorted by effective due ascending: 11th, 13th, 14th
    expect(body.data.map((r) => r.id)).toEqual(['snoozed-null', 'pending-mid', 'snoozed-in']);
  });

  it('paginates past KithLedger\'s 100-row page cap', async () => {
    const many = Array.from({ length: 150 }, (_, i) =>
      reminder({
        id: `r${i.toString().padStart(3, '0')}`,
        dueAt: `2026-08-12T${(i % 24).toString().padStart(2, '0')}:${Math.floor(i / 24).toString().padStart(2, '0')}:00.000Z`,
      }));
    const fake = createFakeKith(many);
    setKithRuntime(runtimeForFakeKith(fake));
    const { adult } = await seedTestHousehold();

    const res = await enabledApp().request(`/api/v1/kith/reminders?${WINDOW}`, { headers: authHeaders(adult.jwt) });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ id: string }> };
    expect(body.data.length).toBe(150);
    expect(fake.requests).toBe(2);
  });

  it('maps an unreachable KithLedger to 502 KITH_UNAVAILABLE without leaking the key', async () => {
    const failingFetch: typeof fetch = async () => {
      throw new TypeError('fetch failed: ECONNREFUSED kl_test-key-must-not-appear');
    };
    setKithRuntime(createKithRuntime({ baseUrl: 'http://kith.test', apiKey: 'kl_secret', keyKind: 'household' }, failingFetch));
    const { adult } = await seedTestHousehold();

    const res = await enabledApp().request(`/api/v1/kith/reminders?${WINDOW}`, { headers: authHeaders(adult.jwt) });
    expect(res.status).toBe(502);
    const text = await res.text();
    const body = JSON.parse(text) as { error: { code: string } };
    expect(body.error.code).toBe('KITH_UNAVAILABLE');
    expect(text).not.toContain('kl_secret');
    expect(text).not.toContain('ECONNREFUSED');
  });

  it('maps an upstream 5xx to 502 KITH_UNAVAILABLE', async () => {
    const brokenFetch: typeof fetch = async () =>
      new Response('upstream exploded', { status: 500 });
    setKithRuntime(createKithRuntime({ baseUrl: 'http://kith.test', apiKey: 'kl_secret', keyKind: 'household' }, brokenFetch));
    const { adult } = await seedTestHousehold();

    const res = await enabledApp().request(`/api/v1/kith/reminders?${WINDOW}`, { headers: authHeaders(adult.jwt) });
    expect(res.status).toBe(502);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('KITH_UNAVAILABLE');
  });
});

/**
 * ADR 0004 §2 / task B8 — the feed presents the HOUSEHOLD dashboard key, so it
 * sees the `household`-visible slice and nothing else, and it never writes.
 */
describe('GET /api/v1/kith/reminders — household credential (ADR 0004 §2.2)', () => {
  it('sends the configured household key, and only GETs', async () => {
    const fake = createFakeKith([reminder({ id: 'shared', dueAt: '2026-08-12T09:00:00.000Z' })], {
      apiKey: 'kl_household-key',
    });
    setKithRuntime(runtimeForFakeKith(fake, { apiKey: 'kl_household-key' }));
    const { adult } = await seedTestHousehold();

    const res = await enabledApp().request(`/api/v1/kith/reminders?${WINDOW}`, { headers: authHeaders(adult.jwt) });
    expect(res.status).toBe(200);
    expect(fake.authHeaders).toEqual(['Bearer kl_household-key']);
    // Read-only by construction: a household key is refused on any non-GET
    // upstream, and this proxy has no code path that could issue one.
    expect(fake.methods.every((m) => m.toUpperCase() === 'GET')).toBe(true);
  });

  it('serves a narrowed result set as an ordinary 200 (private/shared items are simply absent)', async () => {
    // What the household key sees: two `household` reminders. The member's
    // `private` and `shared`-subset ones never reach Heorth at all — they are
    // absent from the rows AND from `meta.total` (§3.4), so the narrowing is
    // just a shorter list, not a short page.
    const fake = createFakeKith([
      reminder({ id: 'household-1', dueAt: '2026-08-12T09:00:00.000Z' }),
      reminder({ id: 'household-2', dueAt: '2026-08-14T09:00:00.000Z' }),
    ]);
    setKithRuntime(runtimeForFakeKith(fake));
    const { adult } = await seedTestHousehold();

    const res = await enabledApp().request(`/api/v1/kith/reminders?${WINDOW}`, { headers: authHeaders(adult.jwt) });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ id: string }> };
    expect(body.data.map((r) => r.id)).toEqual(['household-1', 'household-2']);
    expect(fake.requests).toBe(1);
  });

  it('an entirely narrowed-away window is 200 with an empty list, not an error', async () => {
    setKithRuntime(runtimeForFakeKith(createFakeKith([])));
    const { adult } = await seedTestHousehold();

    const res = await enabledApp().request(`/api/v1/kith/reminders?${WINDOW}`, { headers: authHeaders(adult.jwt) });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(body.data).toEqual([]);
  });

  it('every member gets the same household slice (no per-member forwarding)', async () => {
    const fake = createFakeKith([reminder({ id: 'household-1', dueAt: '2026-08-12T09:00:00.000Z' })]);
    setKithRuntime(runtimeForFakeKith(fake));
    const { adult, child } = await seedTestHousehold();
    const app = enabledApp();

    const bodies = [];
    for (const jwt of [adult.jwt, child.jwt]) {
      const res = await app.request(`/api/v1/kith/reminders?${WINDOW}`, { headers: authHeaders(jwt) });
      expect(res.status).toBe(200);
      bodies.push(await res.json() as { data: Array<{ id: string }> });
    }
    expect(bodies[0]).toEqual(bodies[1]);
    // The Heorth caller's identity is authenticated but never forwarded: both
    // requests carry the same household key and no member context.
    expect(new Set(fake.authHeaders)).toEqual(new Set(['Bearer kl_test-key']));
  });

  it.each([401, 403] as const)(
    'maps an upstream %i to 502 KITH_CREDENTIAL_REJECTED (misconfiguration, not an outage)',
    async (status) => {
      const fake = createFakeKith([], { refuseWith: status });
      setKithRuntime(runtimeForFakeKith(fake));
      const { adult } = await seedTestHousehold();

      const res = await enabledApp().request(`/api/v1/kith/reminders?${WINDOW}`, { headers: authHeaders(adult.jwt) });
      expect(res.status).toBe(502);
      const text = await res.text();
      expect((JSON.parse(text) as { error: { code: string } }).error.code).toBe('KITH_CREDENTIAL_REJECTED');
      expect(text).not.toContain('kl_test-key');
    },
  );
});

describe('KithClient transport', () => {
  it('joins the base URL without double slashes and skips empty query params', async () => {
    const seen: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      seen.push(String(input));
      return Response.json({ data: [], meta: { total: 0, limit: 100, offset: 0 } });
    };
    const client = new KithClient({ baseUrl: 'http://kith.test/', apiKey: 'kl_k', fetch: fetchImpl });
    await client.listReminders({ statuses: 'pending,snoozed', dueBefore: undefined, limit: 100, offset: 0 });
    expect(seen).toEqual(['http://kith.test/api/v1/reminders?statuses=pending%2Csnoozed&limit=100&offset=0']);
  });

  it('turns a timeout into a typed KithUnreachableError', async () => {
    const hangingFetch: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    const client = new KithClient({ baseUrl: 'http://kith.test', apiKey: 'kl_k', timeoutMs: 10, fetch: hangingFetch });
    await expect(client.listReminders({})).rejects.toSatisfy(
      (e: unknown) => e instanceof KithUnreachableError && e.kind === 'timeout',
    );
  });
});

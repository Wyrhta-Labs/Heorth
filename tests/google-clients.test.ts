import { describe, it, expect, afterEach } from 'vitest';
import { Hono } from 'hono';
import { googleFetch, GoogleApiError, GOOGLE_CALENDAR_BASE } from '../src/google/api.js';
import { classify, googleFullResyncIntervalMs } from '../src/google/sync-runner.js';
import { DEFAULT_FULL_RESYNC_INTERVAL_MS } from '../src/integrations/sync-runner.js';

function fetchFor(app: Hono): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) =>
    app.request(input as string, init)) as typeof fetch;
}

describe('googleFetch', () => {
  it('sends the bearer token and returns the parsed body', async () => {
    const app = new Hono();
    let seenAuth = '';
    app.get('/calendar/v3/ping', (c) => {
      seenAuth = c.req.header('Authorization') ?? '';
      return c.json({ pong: true });
    });
    const out = await googleFetch<{ pong: boolean }>(
      { fetch: fetchFor(app) }, 'access-1', `${GOOGLE_CALENDAR_BASE}/ping`,
    );
    expect(out).toEqual({ pong: true });
    expect(seenAuth).toBe('Bearer access-1');
  });

  it('maps a non-2xx response to a GoogleApiError carrying status and reason', async () => {
    const app = new Hono();
    app.get('/calendar/v3/boom', (c) =>
      c.json({ error: { code: 403, message: 'Rate limit', errors: [{ reason: 'rateLimitExceeded' }] } }, 403));
    const e = await googleFetch({ fetch: fetchFor(app) }, 'a', `${GOOGLE_CALENDAR_BASE}/boom`)
      .catch((err: unknown) => err);
    expect(e).toBeInstanceOf(GoogleApiError);
    expect((e as GoogleApiError).status).toBe(403);
    expect((e as GoogleApiError).reason).toBe('rateLimitExceeded');
  });

  it('retries a 429 once, honouring Retry-After', async () => {
    const app = new Hono();
    let calls = 0;
    app.get('/calendar/v3/throttled', (c) => {
      calls += 1;
      if (calls === 1) return c.json({ error: { code: 429 } }, 429, { 'Retry-After': '0' });
      return c.json({ ok: true });
    });
    const out = await googleFetch<{ ok: boolean }>(
      { fetch: fetchFor(app) }, 'a', `${GOOGLE_CALENDAR_BASE}/throttled`,
    );
    expect(out).toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it('returns undefined for a 204 (Tasks PATCH/DELETE answer empty)', async () => {
    const app = new Hono();
    app.patch('/tasks/v1/thing', (c) => c.body(null, 204));
    const out = await googleFetch(
      { fetch: fetchFor(app) }, 'a', 'https://tasks.googleapis.com/tasks/v1/thing', { method: 'PATCH' },
    );
    expect(out).toBeUndefined();
  });
});

describe('google classify', () => {
  it('reports a missing connection before anything else (it also carries 401)', () => {
    expect(classify(new GoogleApiError('none', 401, 'no_connection'))).toBe('no_connection');
  });

  it('maps a 401 to needs_reauth', () => {
    expect(classify(new GoogleApiError('bad token', 401))).toBe('needs_reauth');
  });

  it('maps any other status to google_<status>, never graph_<n>', () => {
    expect(classify(new GoogleApiError('gone', 410, 'fullSyncRequired'))).toBe('google_410');
    expect(classify(new GoogleApiError('boom', 500))).toBe('google_500');
  });

  it('maps a transport failure to network_error and anything else to error', () => {
    expect(classify(new TypeError('fetch failed'))).toBe('network_error');
    expect(classify(new Error('???'))).toBe('error');
  });
});

describe('googleFullResyncIntervalMs', () => {
  afterEach(() => {
    delete process.env['GOOGLE_FULL_RESYNC_INTERVAL_SECONDS'];
  });

  it('defaults to the shared interval', () => {
    delete process.env['GOOGLE_FULL_RESYNC_INTERVAL_SECONDS'];
    expect(googleFullResyncIntervalMs()).toBe(DEFAULT_FULL_RESYNC_INTERVAL_MS);
  });

  it('honours an override and ignores a nonsense value', () => {
    process.env['GOOGLE_FULL_RESYNC_INTERVAL_SECONDS'] = '120';
    expect(googleFullResyncIntervalMs()).toBe(120_000);
    process.env['GOOGLE_FULL_RESYNC_INTERVAL_SECONDS'] = 'soon';
    expect(googleFullResyncIntervalMs()).toBe(DEFAULT_FULL_RESYNC_INTERVAL_MS);
  });
});

import { createKithRuntime, type KithRuntime } from '../src/modules/kith/runtime.js';
import type { KithReminder } from '../src/modules/kith/client.js';

/**
 * In-process fake of KithLedger's `GET /api/v1/reminders` — the kith
 * counterpart of `fake-graph.ts`. Implements the verified upstream semantics:
 * bearer-key auth, `statuses` (comma-separated), `due_before` (inclusive,
 * `lte` in KithLedger's service), `limit` (max 100, default 20) + `offset`
 * pagination, `due_at` ascending order, and the `{ data, meta }` envelope.
 * There is deliberately NO lower-bound param, just like the real API.
 */
export interface FakeKith {
  fetch: typeof fetch;
  /** Every request's Authorization header, for key-forwarding assertions. */
  authHeaders: (string | null)[];
  /** Number of list requests served (asserts pagination behavior). */
  requests: number;
}

export function createFakeKith(reminders: KithReminder[], opts: { apiKey?: string } = {}): FakeKith {
  const apiKey = opts.apiKey ?? 'kl_test-key';
  const fake: FakeKith = { authHeaders: [], requests: 0, fetch: undefined as unknown as typeof fetch };

  fake.fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const headers = new Headers(input instanceof Request ? input.headers : init?.headers);
    fake.authHeaders.push(headers.get('authorization'));
    fake.requests += 1;

    if (headers.get('authorization') !== `Bearer ${apiKey}`) {
      return Response.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid API key' } }, { status: 401 });
    }
    if (url.pathname !== '/api/v1/reminders') {
      return Response.json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }, { status: 404 });
    }

    let rows = [...reminders].sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
    const statuses = url.searchParams.get('statuses');
    if (statuses) {
      const allowed = new Set(statuses.split(','));
      rows = rows.filter((r) => allowed.has(r.status));
    }
    const dueBefore = url.searchParams.get('due_before');
    if (dueBefore) {
      rows = rows.filter((r) => Date.parse(r.dueAt) <= Date.parse(dueBefore));
    }
    const limit = Math.min(Number(url.searchParams.get('limit') ?? '20'), 100);
    const offset = Number(url.searchParams.get('offset') ?? '0');
    const page = rows.slice(offset, offset + limit);
    return Response.json({ data: page, meta: { total: rows.length, limit, offset } });
  };

  return fake;
}

/** A runtime whose client talks to the fake (installed via setKithRuntime). */
export function runtimeForFakeKith(fake: FakeKith, opts: { apiKey?: string } = {}): KithRuntime {
  return createKithRuntime(
    { baseUrl: 'http://kith.test', apiKey: opts.apiKey ?? 'kl_test-key' },
    fake.fetch,
  );
}

/** Convenience reminder factory with sensible defaults. */
export function reminder(over: Partial<KithReminder> & { id: string; dueAt: string }): KithReminder {
  return {
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    personId: 'person-1',
    title: `Reminder ${over.id}`,
    notes: null,
    status: 'pending',
    snoozedUntil: null,
    recurrence: null,
    kind: 'generic',
    leadDays: 0,
    ...over,
  };
}

/**
 * KithLedger HTTP client — the resurrected satellite-client transport pattern
 * (see the retired `src/satellites/satellite-client.ts`, removed when Feoh was
 * merged in). It owns the cross-cutting transport concerns only: base URL
 * joining, the single service API key (`Authorization: Bearer kl_…`), a
 * request timeout, an injectable fetch for tests, and turning a network
 * failure or timeout into a typed {@link KithUnreachableError}. On top of the
 * transport it exposes the one typed operation Heorth needs: listing reminders.
 */

/** Thrown when KithLedger could not be reached at all (connection refused,
 *  DNS failure) or the request exceeded the configured timeout — and also,
 *  by the reminder listing, when KithLedger answered but not with a usable
 *  2xx JSON envelope. Routes map this to 502 KITH_UNAVAILABLE. The message
 *  never contains the API key. */
export class KithUnreachableError extends Error {
  constructor(
    message: string,
    public readonly kind: 'timeout' | 'network' | 'bad_response',
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'KithUnreachableError';
  }
}

/** A reminder exactly as KithLedger's REST API returns it (camelCase JSON). */
export interface KithReminder {
  id: string;
  createdAt: string;
  updatedAt: string;
  personId: string;
  dueAt: string;
  title: string;
  notes: string | null;
  status: 'pending' | 'done' | 'snoozed' | 'dismissed';
  snoozedUntil: string | null;
  recurrence: string | null;
  kind: 'generic' | 'birthday';
  leadDays: number;
}

/** KithLedger's list envelope (`@wyrhta/core/http` shape). */
export interface KithReminderPage {
  data: KithReminder[];
  meta: { total: number; limit: number; offset: number };
}

export interface KithClientOptions {
  baseUrl: string;
  apiKey: string;
  /** Per-request timeout in milliseconds (default 5000). */
  timeoutMs?: number;
  /** Injectable fetch — defaults to the global. Tests pass a fake KithLedger. */
  fetch?: typeof fetch;
}

/** KithLedger caps `limit` at 100; use the maximum to minimize page count. */
export const KITH_PAGE_LIMIT = 100;

export class KithClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: KithClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? 5000;
    this.fetchImpl = opts.fetch ?? fetch;
  }

  private async get(path: string, query: Record<string, string | undefined>): Promise<string> {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== '') params.set(k, v);
    }
    const qs = params.toString();
    const url = `${this.baseUrl}${path}${qs ? `?${qs}` : ''}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.apiKey}`, Accept: 'application/json' },
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        throw new KithUnreachableError(
          `KithLedger answered ${res.status} for ${path}`, 'bad_response',
        );
      }
      return text;
    } catch (e: unknown) {
      if (e instanceof KithUnreachableError) throw e;
      if (controller.signal.aborted) {
        throw new KithUnreachableError(
          `Request to KithLedger ${path} timed out after ${this.timeoutMs}ms`, 'timeout', e,
        );
      }
      throw new KithUnreachableError(`Could not reach KithLedger at ${this.baseUrl}`, 'network', e);
    } finally {
      clearTimeout(timer);
    }
  }

  /** One page of `GET /api/v1/reminders` (ordered by `due_at` ascending). */
  async listReminders(query: {
    statuses?: string;
    dueBefore?: string;
    limit?: number;
    offset?: number;
  }): Promise<KithReminderPage> {
    const text = await this.get('/api/v1/reminders', {
      statuses: query.statuses,
      due_before: query.dueBefore,
      limit: query.limit?.toString(),
      offset: query.offset?.toString(),
    });
    try {
      return JSON.parse(text) as KithReminderPage;
    } catch (e) {
      throw new KithUnreachableError('KithLedger returned a non-JSON reminder page', 'bad_response', e);
    }
  }

  /**
   * All reminders matching the query, following `meta.total` across pages.
   * KithLedger has no lower-bound (`due_after`) filter — callers window the
   * lower bound themselves.
   */
  async listAllReminders(query: { statuses?: string; dueBefore?: string }): Promise<KithReminder[]> {
    const all: KithReminder[] = [];
    let offset = 0;
    for (;;) {
      const page = await this.listReminders({ ...query, limit: KITH_PAGE_LIMIT, offset });
      all.push(...page.data);
      offset += page.data.length;
      // Stop on a short/empty page too, so a lying `total` cannot loop forever.
      if (offset >= page.meta.total || page.data.length === 0) return all;
    }
  }
}

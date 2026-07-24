/**
 * Reusable satellite HTTP client — the prototype pattern for how Heorth
 * consumes every independent satellite service (Feoh is the first). It owns the
 * cross-cutting transport concerns only: base URL joining, the single service
 * API key, a request timeout, and turning a network failure or timeout into a
 * typed {@link SatelliteUnreachableError}. It deliberately does NOT understand
 * any service's payloads — it passes the response body through verbatim as text
 * so a caller can re-emit the JSON envelope (or raw text) unchanged.
 */

/** Thrown when a satellite could not be reached at all (connection refused,
 *  DNS failure) or the request exceeded the configured timeout. Distinct from a
 *  satellite that answered with a 4xx/5xx — those come back as a normal
 *  {@link SatelliteResponse} for the caller to pass through. */
export class SatelliteUnreachableError extends Error {
  constructor(
    message: string,
    public readonly kind: 'timeout' | 'network',
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'SatelliteUnreachableError';
  }
}

export interface SatelliteRequest {
  method: string;
  /** Absolute path on the satellite, e.g. `/api/v1/feoh/accounts`. */
  path: string;
  /** Query params to append; undefined/null/'' entries are skipped. */
  query?: Record<string, string | undefined>;
  /** Pre-serialized request body (JSON string or raw text). */
  body?: string;
  contentType?: string;
  accept?: string;
}

export interface SatelliteResponse {
  status: number;
  contentType: string | null;
  text: string;
}

export interface SatelliteClientOptions {
  baseUrl: string;
  apiKey: string;
  /** Per-request timeout in milliseconds (default 5000). */
  timeoutMs?: number;
  /** Injectable fetch — defaults to the global. Tests pass a fake app's fetch. */
  fetch?: typeof fetch;
}

export class SatelliteClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: SatelliteClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? 5000;
    this.fetchImpl = opts.fetch ?? fetch;
  }

  private buildUrl(path: string, query?: SatelliteRequest['query']): string {
    let url = `${this.baseUrl}${path}`;
    if (query) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && v !== '') params.set(k, v);
      }
      const qs = params.toString();
      if (qs) url += `?${qs}`;
    }
    return url;
  }

  async send(req: SatelliteRequest): Promise<SatelliteResponse> {
    const url = this.buildUrl(req.path, req.query);
    const headers: Record<string, string> = { Authorization: `Bearer ${this.apiKey}` };
    if (req.contentType) headers['Content-Type'] = req.contentType;
    if (req.accept) headers['Accept'] = req.accept;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(url, {
        method: req.method,
        headers,
        body: req.body,
        signal: controller.signal,
      });
      const text = await res.text();
      return { status: res.status, contentType: res.headers.get('content-type'), text };
    } catch (e: unknown) {
      if (controller.signal.aborted) {
        throw new SatelliteUnreachableError(`Request to ${url} timed out after ${this.timeoutMs}ms`, 'timeout', e);
      }
      throw new SatelliteUnreachableError(`Could not reach satellite at ${url}`, 'network', e);
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Microsoft Graph transport — the ONLY place Graph URLs and HTTP concerns live.
 * Providers (Tasks 2.2/2.3) consume typed results through the auth clients and
 * this helper; no Graph URL or raw response type escapes `src/m365/`.
 */

export const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

/** Authority base for the household tenant's OAuth v2 endpoints. */
export function authorityBase(tenantId: string): string {
  return `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0`;
}

/**
 * Typed error for any non-2xx Graph (or identity) response. Carries the HTTP
 * status and the Graph error code when present. Never includes token material.
 */
export class GraphError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string | null = null,
    public readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = 'GraphError';
  }
}

function parseRetryAfter(res: Response): number | null {
  const raw = res.headers.get('retry-after');
  if (!raw) return null;
  const secs = Number(raw);
  return Number.isFinite(secs) ? secs : null;
}

async function toGraphError(res: Response): Promise<GraphError> {
  let code: string | null = null;
  let message = `Graph request failed (${res.status})`;
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    if (body?.error) {
      code = body.error.code ?? null;
      if (body.error.message) message = body.error.message;
    }
  } catch {
    // non-JSON body — keep the generic message
  }
  return new GraphError(message, res.status, code, parseRetryAfter(res));
}

export interface GraphFetchDeps {
  fetch: typeof fetch;
}

/**
 * Bearer-authenticated JSON call to Graph. Handles a single 429 retry honouring
 * Retry-After (capped), and maps any non-2xx to a {@link GraphError}. `path` is
 * relative to {@link GRAPH_BASE} (e.g. `/me`, `/users/{upn}/calendarView`).
 */
export async function graphFetch<T>(
  deps: GraphFetchDeps,
  accessToken: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = path.startsWith('http') ? path : `${GRAPH_BASE}${path}`;
  const doCall = () =>
    deps.fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        ...(init.headers ?? {}),
      },
    });

  let res = await doCall();
  if (res.status === 429) {
    const retryAfter = parseRetryAfter(res);
    const waitMs = Math.min(Math.max((retryAfter ?? 1) * 1000, 0), 5000);
    if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
    res = await doCall();
  }

  if (!res.ok) throw await toGraphError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

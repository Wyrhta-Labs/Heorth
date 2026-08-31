/**
 * Google API transport — the ONLY place Google URLs and HTTP concerns live.
 * Everything else in `src/google/` consumes typed results through this helper,
 * and nothing outside `src/google/` sees a Google URL or raw response type.
 *
 * Unlike Graph, Google has no single API base: Calendar lives on
 * www.googleapis.com and Tasks on tasks.googleapis.com, so {@link googleFetch}
 * takes an ABSOLUTE url rather than a path.
 */

export const GOOGLE_OAUTH_AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_OAUTH_TOKEN = 'https://oauth2.googleapis.com/token';
// The canonical OIDC UserInfo endpoint. (`www.googleapis.com/oauth2/v3/userinfo`
// still answers, but this is the one Google's OIDC discovery document names.)
export const GOOGLE_USERINFO = 'https://openidconnect.googleapis.com/v1/userinfo';
export const GOOGLE_CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3';
export const GOOGLE_TASKS_BASE = 'https://tasks.googleapis.com/tasks/v1';

/**
 * Typed error for any non-2xx Google (or Google identity) response. Carries the
 * HTTP status and Google's own `errors[0].reason` when present (e.g.
 * `rateLimitExceeded`, `fullSyncRequired`). Never includes token material.
 */
export class GoogleApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly reason: string | null = null,
    public readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = 'GoogleApiError';
  }
}

function parseRetryAfter(res: Response): number | null {
  const raw = res.headers.get('retry-after');
  if (!raw) return null;
  const secs = Number(raw);
  return Number.isFinite(secs) ? secs : null;
}

async function toGoogleApiError(res: Response): Promise<GoogleApiError> {
  let reason: string | null = null;
  let message = `Google request failed (${res.status})`;
  try {
    const body = (await res.json()) as {
      error?: { message?: string; status?: string; errors?: Array<{ reason?: string }> };
    };
    if (body?.error) {
      reason = body.error.errors?.[0]?.reason ?? body.error.status ?? null;
      if (body.error.message) message = body.error.message;
    }
  } catch {
    // non-JSON body — keep the generic message
  }
  return new GoogleApiError(message, res.status, reason, parseRetryAfter(res));
}

export interface GoogleFetchDeps {
  fetch: typeof fetch;
}

/**
 * Bearer-authenticated JSON call to a Google API. Handles a single 429 retry
 * honouring Retry-After (capped at 5s), and maps any non-2xx to a
 * {@link GoogleApiError}. `url` is absolute.
 */
export async function googleFetch<T>(
  deps: GoogleFetchDeps,
  accessToken: string,
  url: string,
  init: RequestInit = {},
): Promise<T> {
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

  if (!res.ok) throw await toGoogleApiError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

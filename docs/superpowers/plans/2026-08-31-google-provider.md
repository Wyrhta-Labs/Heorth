# Google Calendar & Tasks Provider Implementation Plan (Phase 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Google (Calendar + Tasks) as a second provider running side by side with Microsoft 365 at full feature parity, on top of the `src/integrations/` layer Phase 1 extracted.

**Architecture:** A new `src/google/` module — the only place Google API types and URLs may appear — supplies an OAuth client, a `GoogleCalendarProvider` (incremental `syncToken`, `singleEvents=true`) and a `GoogleTaskProvider` (full snapshot every pull, reconciled against the mirror), and registers itself into the integrations registry from its module `register()` when the `GOOGLE_*` env group is present. A new `calendar_allowlist` table mirrors `todo_list_allowlist`: nothing syncs until a member picks calendars, and one row household-wide carries `is_household` to designate the shared family calendar. The task allowlist API becomes provider-aware, which is the change that makes a Google list selectable at all.

**Tech Stack:** Node.js 22, TypeScript (ESM, `.js` import specifiers), Hono, Drizzle ORM, PostgreSQL 18, Zod, Vitest, React + TanStack Query + i18next (web).

**Spec:** `docs/superpowers/specs/2026-08-29-google-calendar-tasks-provider-design.md` — Phase 2, plus the two Phase-1 findings embedded in it (the maintenance-admin landmine and the half-migrated task allowlist API). Read the spec before Task 1.

## Global Constraints

- **Containment.** Google API types and URLs may appear ONLY in `src/google/`. Everything provider-agnostic stays in `src/integrations/` and the two module-side contracts (`src/modules/calendar/providers/types.ts`, `src/modules/tasks/providers/types.ts`). Providers depend on those contracts; never the reverse.
- **Optional as a GROUP.** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`: all present → enabled; all absent → the module registers as a no-op; partial presence is a startup error. Adding the group means touching all three of the schema group, the `superRefine` check, and the `config.google` object (`src/config/env.ts`).
- **Never call a real external service from a test.** Fakes install through `setGoogleRuntime`. The scheduler and sync runners never run under tests.
- **Schema** must be registered in BOTH `src/db/schema/drizzle-schema.ts` (no `.js`) and `src/db/schema/index.ts` (with `.js`). Generate migrations with `npm run db:generate -- --name <name>`; never hand-edit snapshots. Inspect the generated SQL before committing — drizzle has mis-generated renames on this schema before.
- **Never log or return token material.** Refresh tokens are encrypted at rest by `src/integrations/crypto.ts`; its HKDF salt/info strings must never change.
- **Store absolute UTC instants.** A source timezone is display metadata only. Date-only values (Google Tasks `due`, Google Calendar all-day `date`) are calendar dates: anchor them to household-local midnight via `zonedMidnightUtc` (`src/lib/local-date.ts`) with `getHouseholdTimeZone()`.
- **Feed keys are built through `feedKeys`** (`src/integrations/feed-keys.ts`) and NOT parsed by the Google providers — they resolve a feed's member/list/calendar from its allowlist row, which they already read to enumerate feeds. Do not copy the M365 providers' regex habit.
- **Error reason tokens** are a contract consumed by REST and MCP status mapping: `needs_reauth`, `no_connection`, `network_error`, `error`, `shared_list_unavailable`, `provider_unavailable`, `unknown_list`, plus `graph_<n>`. Google adds `google_<n>` alongside — it never emits `graph_<n>`.
- **Test database:** `DATABASE_URL` must name a database ending in `_test`. Derive it (never paste the secret):
  ```bash
  export DATABASE_URL="postgres://heorth:$(grep -E '^HEORTH_DB_PASSWORD=' ../deploy/.env | cut -d= -f2- | tr -d '"'\''\r')@localhost:15432/heorth_test"
  ```
- **Verification commands:** `npm run typecheck`, `npm test`, and — mandatory before any push — `cd web && npm run build`, which is the ONLY thing that typechecks the web.
- **Commits:** one concern per commit, no AI co-author trailers, conventional-commit subjects.

---

### Task 1: The `GOOGLE_*` env group

**Files:**
- Modify: `src/config/env.ts:29-45` (schema group), `src/config/env.ts:131-146` (superRefine), `src/config/env.ts:262-274` (config object), `src/config/env.ts:334-341` (exported types)
- Modify: `tests/setup.ts:21-26`
- Test: `tests/google-env.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `config.google` — `{ clientId: string; clientSecret: string; redirectUri: string } | null`; `export type GoogleConfig = NonNullable<typeof config.google>`.

- [ ] **Step 1: Write the failing test**

Create `tests/google-env.test.ts`, modelled on `tests/m365-env.test.ts` (read it first — it owns the `vi.resetModules()` + delete-vars dance this suite copies):

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/google-env.test.ts`
Expected: FAIL — `config.google` is undefined, not null.

- [ ] **Step 3: Add the schema group**

In `src/config/env.ts`, directly after the `M365_FAMILY_MAILBOX` line and before the `INTEGRATIONS_SYNC_INTERVAL_SECONDS` comment block:

```ts
    // Google integration (Calendar + Tasks). Optional AS A GROUP with exactly
    // the same contract as M365_* above: all three present (enabled) or all
    // absent (the google module registers as a no-op). Partial presence is a
    // startup error (see superRefine). There is no family-mailbox equivalent —
    // the shared family calendar is a designated `calendar_allowlist` row — and
    // no shared-list equivalent: the household task list is a flag on
    // `todo_list_allowlist`.
    GOOGLE_CLIENT_ID: emptyToUndefined(z.string().min(1)),
    GOOGLE_CLIENT_SECRET: emptyToUndefined(z.string().min(1)),
    GOOGLE_REDIRECT_URI: emptyToUndefined(z.string().url()),
```

- [ ] **Step 4: Add the all-or-nothing check**

In the `superRefine` body, immediately after the M365 block (`src/config/env.ts:146`):

```ts
    const googleKeys = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI'] as const;
    const googlePresent = googleKeys.filter((k) => env[k] !== undefined && env[k] !== '');
    if (googlePresent.length > 0 && googlePresent.length < googleKeys.length) {
      const missing = googleKeys.filter((k) => env[k] === undefined || env[k] === '');
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['GOOGLE'],
        message:
          `Google integration is partially configured — set all of [${googleKeys.join(', ')}] ` +
          `or none. Missing: ${missing.join(', ')}.`,
      });
    }
```

- [ ] **Step 5: Add the resolved config object and its type**

In the `config` object, immediately after the `m365:` entry:

```ts
  // Resolved Google config, or null when the integration is disabled (env
  // absent). All-or-nothing like m365 above: GOOGLE_CLIENT_ID present implies
  // the rest of the group is present.
  google:
    parsed.GOOGLE_CLIENT_ID
      ? {
          clientId: parsed.GOOGLE_CLIENT_ID,
          clientSecret: parsed.GOOGLE_CLIENT_SECRET!,
          redirectUri: parsed.GOOGLE_REDIRECT_URI!,
        }
      : null,
```

And beside the other exported config types at the bottom of the file:

```ts
/** The resolved Google config shape (present only when enabled). */
export type GoogleConfig = NonNullable<typeof config.google>;
```

- [ ] **Step 6: Force the group disabled for the suite**

In `tests/setup.ts`, extend the blanking loop so the suite can never pick up real credentials from the spawning shell:

```ts
for (const k of [
  'M365_TENANT_ID', 'M365_CLIENT_ID', 'M365_CLIENT_SECRET',
  'M365_REDIRECT_URI', 'M365_FAMILY_MAILBOX',
  // Same reason as the M365 group above: enabled-path Google tests inject a
  // fake-Google runtime via setGoogleRuntime, never real credentials.
  'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI',
]) {
  process.env[k] = '';
}
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run tests/google-env.test.ts tests/env.test.ts tests/m365-env.test.ts && npm run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add src/config/env.ts tests/setup.ts tests/google-env.test.ts
git commit -m "feat(google): add the GOOGLE_* env group"
```

---

### Task 2: Google transport — `GoogleApiError` and `googleFetch`

**Files:**
- Create: `src/google/api.ts`
- Test: `tests/google-clients.test.ts`

**Interfaces:**
- Consumes: `config.google` / `GoogleConfig` (Task 1).
- Produces:
  - `GOOGLE_OAUTH_AUTHORIZE`, `GOOGLE_OAUTH_TOKEN`, `GOOGLE_USERINFO`, `GOOGLE_CALENDAR_BASE`, `GOOGLE_TASKS_BASE` — string constants.
  - `class GoogleApiError extends Error { readonly status: number; readonly reason: string | null; readonly retryAfterSeconds: number | null }`
  - `interface GoogleFetchDeps { fetch: typeof fetch }`
  - `googleFetch<T>(deps: GoogleFetchDeps, accessToken: string, url: string, init?: RequestInit): Promise<T>` — `url` is ABSOLUTE (Google serves Calendar and Tasks from different hosts, unlike Graph's single base).

- [ ] **Step 1: Write the failing test**

Create `tests/google-clients.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { googleFetch, GoogleApiError, GOOGLE_CALENDAR_BASE } from '../src/google/api.js';

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/google-clients.test.ts`
Expected: FAIL — cannot resolve `../src/google/api.js`.

- [ ] **Step 3: Write the implementation**

Create `src/google/api.ts`:

```ts
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
export const GOOGLE_USERINFO = 'https://www.googleapis.com/oauth2/v3/userinfo';
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
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/google-clients.test.ts && npm run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/google/api.ts tests/google-clients.test.ts
git commit -m "feat(google): add the Google API transport and typed error"
```

---

### Task 3: Google error classification and re-sync cadence

**Files:**
- Create: `src/google/sync-runner.ts`
- Test: `tests/google-clients.test.ts` (append a `describe` block)

**Interfaces:**
- Consumes: `GoogleApiError` (Task 2), `DEFAULT_FULL_RESYNC_INTERVAL_MS` from `src/integrations/sync-runner.js`.
- Produces:
  - `classify(e: unknown): string` — `'no_connection' | 'needs_reauth' | 'google_<status>' | 'network_error' | 'error'`
  - `googleFullResyncIntervalMs(): number`

- [ ] **Step 1: Write the failing test**

Append to `tests/google-clients.test.ts`:

```ts
import { classify, googleFullResyncIntervalMs } from '../src/google/sync-runner.js';
import { DEFAULT_FULL_RESYNC_INTERVAL_MS } from '../src/integrations/sync-runner.js';

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
  it('defaults to the shared interval', () => {
    delete process.env['GOOGLE_FULL_RESYNC_INTERVAL_SECONDS'];
    expect(googleFullResyncIntervalMs()).toBe(DEFAULT_FULL_RESYNC_INTERVAL_MS);
  });

  it('honours an override and ignores a nonsense value', () => {
    process.env['GOOGLE_FULL_RESYNC_INTERVAL_SECONDS'] = '120';
    expect(googleFullResyncIntervalMs()).toBe(120_000);
    process.env['GOOGLE_FULL_RESYNC_INTERVAL_SECONDS'] = 'soon';
    expect(googleFullResyncIntervalMs()).toBe(DEFAULT_FULL_RESYNC_INTERVAL_MS);
    delete process.env['GOOGLE_FULL_RESYNC_INTERVAL_SECONDS'];
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/google-clients.test.ts`
Expected: FAIL — cannot resolve `../src/google/sync-runner.js`.

- [ ] **Step 3: Write the implementation**

Create `src/google/sync-runner.ts`:

```ts
import { GoogleApiError } from './api.js';
import { DEFAULT_FULL_RESYNC_INTERVAL_MS } from '../integrations/sync-runner.js';

/**
 * Classify a Google failure into a SHORT, safe token for
 * `integration_sync_state.lastError`. Never returns an upstream response body or
 * token material. Passed to the generic runner as `classifyError` — the runner
 * itself has no Google knowledge.
 *
 * The sibling of `src/m365/sync-runner.ts`'s `classify`, and like it this file
 * RUNS nothing despite the name: the runner is `src/integrations/sync-runner.ts`.
 */
export function classify(e: unknown): string {
  if (e instanceof GoogleApiError) {
    // no_connection first: it also carries 401, so the needs_reauth branch
    // would otherwise swallow it. Matters on the write-back path, which reaches
    // classify directly rather than short-circuiting in the sync runner.
    if (e.reason === 'no_connection') return 'no_connection';
    if (e.reason === 'needs_reauth' || e.status === 401) return 'needs_reauth';
    return `google_${e.status}`;
  }
  if (e instanceof TypeError) return 'network_error';
  return 'error';
}

/**
 * Google's re-window cadence. Overridable for ops tuning; not a credential, so
 * it lives outside the GOOGLE_* group exactly like M365's own knob.
 *
 * It governs the CALENDAR feeds only in practice: `GoogleTaskProvider` pulls a
 * complete snapshot on every tick, so a periodic forced full re-sync is already
 * what it always does.
 */
export function googleFullResyncIntervalMs(): number {
  const raw = process.env['GOOGLE_FULL_RESYNC_INTERVAL_SECONDS'];
  if (!raw) return DEFAULT_FULL_RESYNC_INTERVAL_MS;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0
    ? seconds * 1000
    : DEFAULT_FULL_RESYNC_INTERVAL_MS;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/google-clients.test.ts && npm run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/google/sync-runner.ts tests/google-clients.test.ts
git commit -m "feat(google): classify Google failures into safe reason tokens"
```

---

### Task 4: OAuth client, runtime, and the fake-Google identity endpoints

**Files:**
- Create: `src/google/oauth.ts`, `src/google/runtime.ts`, `tests/fake-google.ts`
- Test: `tests/google-clients.test.ts` (append), `tests/google-oauth.test.ts`

**Interfaces:**
- Consumes: `GoogleConfig` (Task 1), `googleFetch` / `GoogleApiError` / URL constants (Task 2), `IntegrationStore` from `src/integrations/store.js`.
- Produces:
  - `GOOGLE_SCOPES: string`
  - `class GoogleNoRefreshTokenError extends Error`
  - `class GoogleOAuthClient { authorizeUrl(state: string): string; exchangeCode(code: string): Promise<{ refreshToken: string; accessToken: string; scopes: string }>; getUserEmail(accessToken: string): Promise<string>; getAccessToken(memberId: string): Promise<string>; clearCache(): void }`
  - `interface GoogleRuntime { config: GoogleConfig; store: IntegrationStore; oauth: GoogleOAuthClient; googleFetch: <T>(accessToken: string, url: string, init?: RequestInit) => Promise<T> }`
  - `isGoogleEnabled(): boolean`, `createGoogleRuntime(cfg, fetchImpl?): GoogleRuntime`, `getGoogleRuntime(): GoogleRuntime`, `setGoogleRuntime(next: GoogleRuntime | null): void`
  - From `tests/fake-google.ts`: `createFakeGoogle(): FakeGoogle`, `runtimeForFakeGoogle(fake: FakeGoogle): GoogleRuntime`, `fakeGoogleConfig`

- [ ] **Step 1: Write the fake's identity half**

Create `tests/fake-google.ts`. Tasks 7 and 9 extend this same file with the Calendar and Tasks endpoints; keep the shape open for that.

```ts
import { Hono } from 'hono';
import type { GoogleConfig } from '../src/config/env.js';
import { createGoogleRuntime, type GoogleRuntime } from '../src/google/runtime.js';
import { GOOGLE_SCOPES } from '../src/google/oauth.js';

/**
 * In-process fake of Google's identity platform and APIs, the sibling of
 * `tests/fake-graph.ts`. Our Google clients take an injectable `fetch`;
 * `runtimeForFakeGoogle` wires a real store + these fake endpoints so tests
 * never touch a real Google project. Routed by pathname only, so one app serves
 * accounts.google.com, oauth2.googleapis.com, www.googleapis.com and
 * tasks.googleapis.com at once.
 */

export interface FakeGoogleCall {
  method: string;
  path: string;
  grantType?: string;
  /** Raw query string (no leading `?`) — lets tests assert a fresh window
   *  (`timeMin=`) vs. a replayed token (`syncToken=`). */
  query?: string;
  body?: unknown;
}

export interface FakeGoogle {
  app: Hono;
  calls: FakeGoogleCall[];
  /** Number of refresh_token grants served (rotation counter). */
  refreshCount: number;
  /** When true, the authorization_code exchange omits refresh_token. */
  omitRefreshToken: boolean;
  /** When true, refresh_token grants return 400 invalid_grant. */
  failRefresh: boolean;
  /** Email returned by the userinfo endpoint. */
  userEmail: string;
}

const TEST_CONFIG: GoogleConfig = {
  clientId: 'test-google-client-id',
  clientSecret: 'test-google-client-secret',
  redirectUri: 'http://localhost:4000/api/v1/integrations/google/callback',
};

export function createFakeGoogle(): FakeGoogle {
  const state: FakeGoogle = {
    app: new Hono(),
    calls: [],
    refreshCount: 0,
    omitRefreshToken: false,
    failRefresh: false,
    userEmail: 'member@gmail.test',
  };

  // Token endpoint (authorization_code / refresh_token).
  state.app.post('/token', async (c) => {
    const form = await c.req.parseBody();
    const grantType = String(form['grant_type'] ?? '');
    state.calls.push({ method: 'POST', path: '/token', grantType });

    if (grantType === 'authorization_code') {
      return c.json({
        token_type: 'Bearer',
        expires_in: 3599,
        scope: GOOGLE_SCOPES,
        access_token: 'google-access-initial',
        ...(state.omitRefreshToken ? {} : { refresh_token: 'google-refresh-initial' }),
      });
    }
    if (grantType === 'refresh_token') {
      if (state.failRefresh) {
        return c.json({ error: 'invalid_grant', error_description: 'expired or revoked' }, 400);
      }
      state.refreshCount += 1;
      // Google does NOT rotate refresh tokens on refresh — the response carries
      // an access token only. The client must keep the stored one.
      return c.json({
        token_type: 'Bearer',
        expires_in: 3599,
        scope: GOOGLE_SCOPES,
        access_token: `google-access-r${state.refreshCount}`,
      });
    }
    return c.json({ error: 'unsupported_grant_type' }, 400);
  });

  // Userinfo — the account label.
  state.app.get('/oauth2/v3/userinfo', (c) => {
    state.calls.push({ method: 'GET', path: '/oauth2/v3/userinfo' });
    return c.json({ sub: 'google-user-id', email: state.userEmail, email_verified: true });
  });

  return state;
}

/** Build a GoogleRuntime whose clients talk to the in-process fake over its fetch. */
export function runtimeForFakeGoogle(fake: FakeGoogle): GoogleRuntime {
  const fakeFetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    fake.app.request(input as string, init)) as typeof fetch;
  return createGoogleRuntime(TEST_CONFIG, fakeFetch);
}

export { TEST_CONFIG as fakeGoogleConfig };
```

- [ ] **Step 2: Write the failing test**

Create `tests/google-oauth.test.ts`. It needs a seeded member (a connection row has an FK to `users`), so it follows the DB-backed suite pattern:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { seedTestHousehold } from './helpers.js';
import { createFakeGoogle, runtimeForFakeGoogle, type FakeGoogle } from './fake-google.js';
import { GoogleNoRefreshTokenError, GOOGLE_SCOPES } from '../src/google/oauth.js';
import type { GoogleRuntime } from '../src/google/runtime.js';

let fake: FakeGoogle;
let rt: GoogleRuntime;

beforeEach(() => {
  fake = createFakeGoogle();
  rt = runtimeForFakeGoogle(fake);
});

describe('GoogleOAuthClient.authorizeUrl', () => {
  it('always carries access_type=offline and prompt=consent', () => {
    const url = new URL(rt.oauth.authorizeUrl('state-token'));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBe('state-token');
    expect(url.searchParams.get('scope')).toBe(GOOGLE_SCOPES);
  });
});

describe('GoogleOAuthClient.exchangeCode', () => {
  it('returns the refresh token and granted scopes', async () => {
    const out = await rt.oauth.exchangeCode('auth-code');
    expect(out.refreshToken).toBe('google-refresh-initial');
    expect(out.accessToken).toBe('google-access-initial');
    expect(out.scopes).toBe(GOOGLE_SCOPES);
  });

  it('FAILS LOUDLY when Google issues no refresh token', async () => {
    fake.omitRefreshToken = true;
    await expect(rt.oauth.exchangeCode('auth-code')).rejects.toBeInstanceOf(GoogleNoRefreshTokenError);
  });
});

describe('GoogleOAuthClient.getAccessToken', () => {
  it('refreshes from the stored token and KEEPS it (Google does not rotate)', async () => {
    const { adult } = await seedTestHousehold();
    await rt.store.upsertConnection({
      memberId: adult.user.id, accountLabel: 'a@gmail.test',
      refreshToken: 'stored-refresh', scopes: GOOGLE_SCOPES,
    });
    const token = await rt.oauth.getAccessToken(adult.user.id);
    expect(token).toBe('google-access-r1');
    expect(await rt.store.getRefreshToken(adult.user.id)).toBe('stored-refresh');
  });

  it('caches the access token for the member', async () => {
    const { adult } = await seedTestHousehold();
    await rt.store.upsertConnection({
      memberId: adult.user.id, accountLabel: 'a@gmail.test',
      refreshToken: 'stored-refresh', scopes: GOOGLE_SCOPES,
    });
    await rt.oauth.getAccessToken(adult.user.id);
    await rt.oauth.getAccessToken(adult.user.id);
    expect(fake.refreshCount).toBe(1);
  });

  it('marks the connection needs_reauth when the refresh is rejected', async () => {
    const { adult } = await seedTestHousehold();
    await rt.store.upsertConnection({
      memberId: adult.user.id, accountLabel: 'a@gmail.test',
      refreshToken: 'stored-refresh', scopes: GOOGLE_SCOPES,
    });
    fake.failRefresh = true;
    await expect(rt.oauth.getAccessToken(adult.user.id)).rejects.toThrow();
    expect((await rt.store.getConnection(adult.user.id))!.status).toBe('needs_reauth');
  });

  it('reports no_connection when the member has never connected', async () => {
    const { child } = await seedTestHousehold();
    const e = await rt.oauth.getAccessToken(child.user.id).catch((err: unknown) => err);
    expect((e as { reason?: string }).reason).toBe('no_connection');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/google-oauth.test.ts`
Expected: FAIL — cannot resolve `../src/google/oauth.js`.

- [ ] **Step 4: Write `src/google/oauth.ts`**

```ts
import type { GoogleConfig } from '../config/env.js';
import type { IntegrationStore } from '../integrations/store.js';
import {
  GoogleApiError, googleFetch,
  GOOGLE_OAUTH_AUTHORIZE, GOOGLE_OAUTH_TOKEN, GOOGLE_USERINFO,
} from './api.js';

/**
 * Delegated scopes Heorth requests. `calendar.readonly` because the mirror is
 * read-only (ADR 0001 phase 1); `tasks` is read/write because completion writes
 * back and Heorth creates tasks outward; `email` resolves the account label.
 */
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/tasks',
  'openid',
  'email',
].join(' ');

/**
 * The connect flow returned no refresh token.
 *
 * Google issues one ONLY on the first consent for a given client/user pair
 * unless the authorize URL carries both `access_type=offline` and
 * `prompt=consent` — and even with both, a malformed flow can come back without
 * one. Storing such a connection produces something that works for about an
 * hour and then dies silently, presenting as "it worked yesterday". So this is
 * a hard failure at connect time, not a warning.
 */
export class GoogleNoRefreshTokenError extends Error {
  constructor() {
    super('Google returned no refresh_token — the connection would expire within the hour');
    this.name = 'GoogleNoRefreshTokenError';
  }
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  token_type?: string;
}

interface UserInfo {
  sub: string;
  email?: string;
}

interface CachedAccess {
  token: string;
  expiresAt: number; // epoch ms
}

const EXPIRY_SKEW_MS = 60_000; // refresh a minute early

/**
 * Delegated (per-member) auth-code client for Google. Builds the authorize URL,
 * exchanges the callback code, and hands out access tokens — refreshing on
 * demand from the stored refresh token.
 *
 * Note the difference from {@link import('../m365/delegated.js').DelegatedClient}:
 * Google does NOT rotate refresh tokens on refresh, so a successful refresh
 * records success WITHOUT re-storing a token. Passing `undefined` to
 * `recordRefreshSuccess` is what keeps the stored ciphertext untouched.
 */
export class GoogleOAuthClient {
  private readonly cache = new Map<string, CachedAccess>();

  constructor(
    private readonly cfg: GoogleConfig,
    private readonly store: IntegrationStore,
    private readonly fetchImpl: typeof fetch,
  ) {}

  /** Google consent URL. `state` binds the member (signed, see integrations/state.ts). */
  authorizeUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.cfg.clientId,
      redirect_uri: this.cfg.redirectUri,
      response_type: 'code',
      scope: GOOGLE_SCOPES,
      // BOTH are required for a refresh token to be issued at all. See
      // GoogleNoRefreshTokenError. `prompt=consent` also forces re-issue on a
      // reconnect, which is exactly the case that otherwise fails silently.
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
    });
    return `${GOOGLE_OAUTH_AUTHORIZE}?${params.toString()}`;
  }

  private async postToken(body: Record<string, string>): Promise<TokenResponse> {
    const res = await this.fetchImpl(GOOGLE_OAUTH_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(body).toString(),
    });
    if (!res.ok) {
      let reason: string | null = null;
      try {
        const j = (await res.json()) as { error?: string };
        reason = j.error ?? null;
      } catch { /* ignore */ }
      throw new GoogleApiError(`Google token request failed (${res.status})`, res.status, reason);
    }
    return (await res.json()) as TokenResponse;
  }

  /** Exchange the callback code. Throws when no refresh token comes back. */
  async exchangeCode(code: string): Promise<{ refreshToken: string; accessToken: string; scopes: string }> {
    const tok = await this.postToken({
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.cfg.redirectUri,
    });
    if (!tok.refresh_token) throw new GoogleNoRefreshTokenError();
    return {
      refreshToken: tok.refresh_token,
      accessToken: tok.access_token,
      scopes: tok.scope ?? GOOGLE_SCOPES,
    };
  }

  /** The signed-in account's email, used as the connection's `accountLabel`. */
  async getUserEmail(accessToken: string): Promise<string> {
    const me = await googleFetch<UserInfo>({ fetch: this.fetchImpl }, accessToken, GOOGLE_USERINFO);
    return me.email ?? me.sub;
  }

  /**
   * A valid access token for the member — from cache, or refreshed from the
   * stored refresh token. A rejected refresh marks the connection
   * `needs_reauth`; so does a decryption failure (JWT_SECRET rotated), which is
   * equally unrecoverable without re-consent.
   */
  async getAccessToken(memberId: string): Promise<string> {
    const cached = this.cache.get(memberId);
    if (cached && cached.expiresAt > Date.now() + EXPIRY_SKEW_MS) return cached.token;

    let refreshToken: string | null;
    try {
      refreshToken = await this.store.getRefreshToken(memberId);
    } catch (e) {
      await this.store.recordRefreshError(memberId, (e as Error).message, 'needs_reauth');
      this.cache.delete(memberId);
      throw new GoogleApiError('Stored Google refresh token could not be decrypted', 401, 'needs_reauth');
    }
    if (!refreshToken) throw new GoogleApiError('No Google connection for member', 401, 'no_connection');

    let tok: TokenResponse;
    try {
      tok = await this.postToken({
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      });
    } catch (e) {
      const needsReauth = e instanceof GoogleApiError && (e.status === 400 || e.status === 401);
      await this.store.recordRefreshError(
        memberId, (e as Error).message, needsReauth ? 'needs_reauth' : 'error',
      );
      this.cache.delete(memberId);
      throw e;
    }

    // No rotated token to persist: Google keeps issuing against the same one.
    await this.store.recordRefreshSuccess(memberId);
    this.cache.set(memberId, { token: tok.access_token, expiresAt: Date.now() + tok.expires_in * 1000 });
    return tok.access_token;
  }

  /** Test/maintenance hook: drop the in-memory access-token cache. */
  clearCache(): void {
    this.cache.clear();
  }
}
```

- [ ] **Step 5: Write `src/google/runtime.ts`**

```ts
import { config, type GoogleConfig } from '../config/env.js';
import { IntegrationStore } from '../integrations/store.js';
import { googleFetch } from './api.js';
import { GoogleOAuthClient } from './oauth.js';

/**
 * The live Google dependencies the provider implementations resolve per call —
 * the exact sibling of `src/m365/runtime.ts`:
 *  - `config`      — resolved Google settings.
 *  - `store`       — connections + generic sync state, scoped to 'google'.
 *  - `oauth`       — per-member access tokens (auth-code flow).
 *  - `googleFetch` — bearer JSON call with 429 retry + typed GoogleApiError.
 *
 * There is no app-only client: Google's household calendar is a DELEGATED feed
 * designated on one member's connection, deliberately, so this works for a
 * consumer Gmail account with no Workspace domain-wide delegation.
 */
export interface GoogleRuntime {
  config: GoogleConfig;
  store: IntegrationStore;
  oauth: GoogleOAuthClient;
  googleFetch: <T>(accessToken: string, url: string, init?: RequestInit) => Promise<T>;
}

/** Whether the integration is configured (all GOOGLE_* env present). */
export function isGoogleEnabled(): boolean {
  return config.google !== null;
}

/** Assemble a runtime from an explicit config + fetch (tests pass a fake). */
export function createGoogleRuntime(cfg: GoogleConfig, fetchImpl: typeof fetch = fetch): GoogleRuntime {
  const store = new IntegrationStore('google');
  const oauth = new GoogleOAuthClient(cfg, store, fetchImpl);
  return {
    config: cfg,
    store,
    oauth,
    googleFetch: <T>(accessToken: string, url: string, init?: RequestInit) =>
      googleFetch<T>({ fetch: fetchImpl }, accessToken, url, init),
  };
}

let runtime: GoogleRuntime | null = null;

/** Lazily-initialized singleton; only valid when the integration is enabled. */
export function getGoogleRuntime(): GoogleRuntime {
  if (!runtime) {
    if (!config.google) {
      throw new Error('Google integration is disabled (no GOOGLE_* env) — getGoogleRuntime must not be called');
    }
    runtime = createGoogleRuntime(config.google);
  }
  return runtime;
}

/** Test seam: install a runtime backed by a fake Google (or null to reset). */
export function setGoogleRuntime(next: GoogleRuntime | null): void {
  runtime = next;
}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/google-oauth.test.ts tests/google-clients.test.ts && npm run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 7: Prove the refresh-token guard bites**

Temporarily delete the `if (!tok.refresh_token) throw new GoogleNoRefreshTokenError();` line, re-run `npx vitest run tests/google-oauth.test.ts`, and confirm "FAILS LOUDLY when Google issues no refresh token" fails. Restore the line.

- [ ] **Step 8: Commit**

```bash
git add src/google/oauth.ts src/google/runtime.ts tests/fake-google.ts tests/google-oauth.test.ts
git commit -m "feat(google): add the delegated OAuth client and runtime seam"
```

---

---

### Task 5: `calendar_allowlist` — schema, migration and store

**Files:**
- Create: `src/modules/calendar/allowlist-schema.ts`, `src/modules/calendar/allowlist-store.ts`, `src/db/migrations/0027_calendar_allowlist.sql` (generated)
- Modify: `src/db/schema/drizzle-schema.ts`, `src/db/schema/index.ts`
- Test: `tests/calendar-allowlist.test.ts`

**Interfaces:**
- Consumes: `feedKeys` (`src/integrations/feed-keys.js`), `integrationSyncState` (`src/integrations/schema.js`), `calendarMirrorEvents` (`src/modules/calendar/mirror-schema.js`).
- Produces:
  - `calendarAllowlist` table + `type CalendarAllowlistRow`
  - `interface CalendarAllowlistFeed { provider: string; feedKey: string; memberId: string; calendarId: string; calendarName: string | null; isHousehold: boolean }`
  - `getCalendarAllowlist(memberId: string, provider?: string): Promise<CalendarAllowlistRow[]>`
  - `setCalendarAllowlist(memberId: string, provider: string, calendars: Array<{ id: string; name: string | null }>): Promise<CalendarAllowlistRow[]>`
  - `listAllowlistedCalendarFeeds(provider?: string): Promise<CalendarAllowlistFeed[]>`
  - `getCalendarFeedByKey(feedKey: string): Promise<CalendarAllowlistFeed | null>`
  - `getHouseholdCalendar(): Promise<CalendarAllowlistFeed | null>`
  - `setHouseholdCalendar(memberId: string, provider: string, calendarId: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `tests/calendar-allowlist.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { seedTestHousehold } from './helpers.js';
import { integrationSyncState } from '../src/integrations/schema.js';
import { calendarMirrorEvents } from '../src/modules/calendar/mirror-schema.js';
import {
  getCalendarAllowlist, setCalendarAllowlist, listAllowlistedCalendarFeeds,
  getCalendarFeedByKey, getHouseholdCalendar, setHouseholdCalendar,
} from '../src/modules/calendar/allowlist-store.js';

describe('calendar allowlist store', () => {
  it('starts empty — nothing syncs by default', async () => {
    const { adult } = await seedTestHousehold();
    expect(await getCalendarAllowlist(adult.user.id)).toEqual([]);
    expect(await listAllowlistedCalendarFeeds('google')).toEqual([]);
  });

  it('replaces a member selection and builds provider-prefixed feed keys', async () => {
    const { adult } = await seedTestHousehold();
    await setCalendarAllowlist(adult.user.id, 'google', [
      { id: 'cal-primary', name: 'Primary' },
      { id: 'cal-sport', name: 'Sport' },
    ]);
    const feeds = await listAllowlistedCalendarFeeds('google');
    expect(feeds.map((f) => f.feedKey).sort()).toEqual([
      `google:calendar:member:${adult.user.id}:cal-primary`,
      `google:calendar:member:${adult.user.id}:cal-sport`,
    ]);
  });

  it('drops a de-selected calendar and clears its mirrored events', async () => {
    const { adult } = await seedTestHousehold();
    await setCalendarAllowlist(adult.user.id, 'google', [{ id: 'cal-sport', name: 'Sport' }]);
    const feedKey = `google:calendar:member:${adult.user.id}:cal-sport`;
    await db.insert(calendarMirrorEvents).values({
      source: 'google', feedKey, externalId: 'ev-1', memberId: adult.user.id,
      title: 'Match', startAt: new Date('2026-09-01T09:00:00Z'), endAt: new Date('2026-09-01T10:00:00Z'),
    });

    await setCalendarAllowlist(adult.user.id, 'google', []);

    expect(await getCalendarAllowlist(adult.user.id, 'google')).toEqual([]);
    const left = await db.select().from(calendarMirrorEvents).where(eq(calendarMirrorEvents.feedKey, feedKey));
    expect(left).toEqual([]);
  });

  it('resolves a feed by its key without parsing it', async () => {
    const { adult } = await seedTestHousehold();
    await setCalendarAllowlist(adult.user.id, 'google', [{ id: 'cal:with:colons', name: 'Odd' }]);
    const feed = await getCalendarFeedByKey(`google:calendar:member:${adult.user.id}:cal:with:colons`);
    expect(feed).toMatchObject({ provider: 'google', calendarId: 'cal:with:colons', memberId: adult.user.id });
  });

  it('designates exactly one household calendar, household-wide', async () => {
    const { adult, child } = await seedTestHousehold();
    await setCalendarAllowlist(adult.user.id, 'google', [{ id: 'cal-a', name: 'A' }]);
    await setCalendarAllowlist(child.user.id, 'google', [{ id: 'cal-b', name: 'B' }]);

    await setHouseholdCalendar(adult.user.id, 'google', 'cal-a');
    expect(await getHouseholdCalendar()).toMatchObject({ memberId: adult.user.id, calendarId: 'cal-a' });

    await setHouseholdCalendar(child.user.id, 'google', 'cal-b');
    expect(await getHouseholdCalendar()).toMatchObject({ memberId: child.user.id, calendarId: 'cal-b' });
    const all = [
      ...(await getCalendarAllowlist(adult.user.id, 'google')),
      ...(await getCalendarAllowlist(child.user.id, 'google')),
    ];
    expect(all.filter((r) => r.isHousehold)).toHaveLength(1);
  });

  it('clears the feed sync token when a designation changes, forcing a re-attribution resync', async () => {
    const { adult } = await seedTestHousehold();
    await setCalendarAllowlist(adult.user.id, 'google', [{ id: 'cal-a', name: 'A' }]);
    const feedKey = `google:calendar:member:${adult.user.id}:cal-a`;
    await db.insert(integrationSyncState).values({
      feedKey, syncToken: 'tok-1', lastFullSyncAt: new Date(),
    });

    await setHouseholdCalendar(adult.user.id, 'google', 'cal-a');

    const [state] = await db.select().from(integrationSyncState)
      .where(eq(integrationSyncState.feedKey, feedKey));
    expect(state!.syncToken).toBeNull();
    expect(state!.lastFullSyncAt).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/calendar-allowlist.test.ts`
Expected: FAIL — cannot resolve `allowlist-store.js`.

- [ ] **Step 3: Write the schema**

Create `src/modules/calendar/allowlist-schema.ts`:

```ts
import { pgTable, text, uuid, timestamp, boolean, unique, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from '@wyrhta/core/identity';

/**
 * Per-member calendar allowlist — the exact sibling of `todo_list_allowlist`.
 * Nothing syncs by default: a member selects which of their calendars mirror,
 * and the presence of a row IS the feed
 * (`<provider>:calendar:member:<memberId>:<calendarId>`).
 *
 * `is_household` designates THE shared family calendar. At most one row
 * household-wide carries it (partial unique index below). It controls
 * ATTRIBUTION only — the provider emits `kind: 'family'` and `memberId: null`
 * for that feed's events, so they render as shared rather than as the
 * designating member's. The feed key stays member-scoped and stable either way,
 * so toggling the flag never orphans sync state.
 *
 * Why a designated member's calendar rather than a service account: it must
 * work for a consumer Gmail account, where there is no Workspace domain-wide
 * delegation to grant. The accepted cost is that the family feed stops if that
 * member disconnects, which `/api/v1/integrations/status` surfaces.
 */
export const calendarAllowlist = pgTable('calendar_allowlist', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  // Which provider this calendar belongs to ('m365' | 'google'). No default:
  // unlike todo_list_allowlist there are no pre-existing rows to backfill.
  provider: text('provider').notNull(),
  memberId: uuid('member_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  calendarId: text('calendar_id').notNull(),
  calendarName: text('calendar_name'),
  isHousehold: boolean('is_household').notNull().default(false),
}, (t) => [
  unique('calendar_allowlist_provider_member_cal_unique').on(t.provider, t.memberId, t.calendarId),
  index('calendar_allowlist_member_idx').on(t.memberId),
  uniqueIndex('calendar_allowlist_single_household')
    .on(t.isHousehold).where(sql`${t.isHousehold}`),
]);

export type CalendarAllowlistRow = typeof calendarAllowlist.$inferSelect;
```

- [ ] **Step 4: Register the schema in both barrels**

In `src/db/schema/drizzle-schema.ts`, after the `mirror-schema` line:

```ts
export * from '../../modules/calendar/allowlist-schema';
```

In `src/db/schema/index.ts`, after the `mirror-schema.js` line:

```ts
export * from '../../modules/calendar/allowlist-schema.js';
```

- [ ] **Step 5: Write the store**

Create `src/modules/calendar/allowlist-store.ts`:

```ts
import { and, asc, eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { feedKeys } from '../../integrations/feed-keys.js';
import { integrationSyncState } from '../../integrations/schema.js';
import { calendarMirrorEvents } from './mirror-schema.js';
import { calendarAllowlist, type CalendarAllowlistRow } from './allowlist-schema.js';

/** A feed = one allowlisted calendar of one member, at one provider. */
export interface CalendarAllowlistFeed {
  provider: string;
  feedKey: string;
  memberId: string;
  calendarId: string;
  calendarName: string | null;
  isHousehold: boolean;
}

function toFeed(row: CalendarAllowlistRow): CalendarAllowlistFeed {
  return {
    provider: row.provider,
    feedKey: feedKeys.calendarList(row.provider, row.memberId, row.calendarId),
    memberId: row.memberId,
    calendarId: row.calendarId,
    calendarName: row.calendarName,
    isHousehold: row.isHousehold,
  };
}

export async function getCalendarAllowlist(
  memberId: string, provider?: string,
): Promise<CalendarAllowlistRow[]> {
  const where = provider
    ? and(eq(calendarAllowlist.memberId, memberId), eq(calendarAllowlist.provider, provider))
    : eq(calendarAllowlist.memberId, memberId);
  return db.select().from(calendarAllowlist).where(where).orderBy(asc(calendarAllowlist.calendarName));
}

/**
 * Replace a member's allowlist for ONE provider. De-selected calendars lose
 * their row AND their mirrored events, so an unpicked calendar disappears from
 * the wall immediately instead of lingering until something re-syncs. The other
 * provider's rows for the same member are untouched — the exact semantics of
 * `setAllowlist` in the tasks store.
 */
export async function setCalendarAllowlist(
  memberId: string, provider: string, calendars: Array<{ id: string; name: string | null }>,
): Promise<CalendarAllowlistRow[]> {
  const keepIds = new Set(calendars.map((c) => c.id));
  return db.transaction(async (tx) => {
    const existing = await tx.select().from(calendarAllowlist)
      .where(and(eq(calendarAllowlist.memberId, memberId), eq(calendarAllowlist.provider, provider)));

    for (const row of existing) {
      if (!keepIds.has(row.calendarId)) {
        await tx.delete(calendarAllowlist).where(eq(calendarAllowlist.id, row.id));
        await tx.delete(calendarMirrorEvents)
          .where(eq(calendarMirrorEvents.feedKey, feedKeys.calendarList(provider, memberId, row.calendarId)));
      }
    }

    for (const c of calendars) {
      await tx.insert(calendarAllowlist)
        .values({ memberId, provider, calendarId: c.id, calendarName: c.name })
        .onConflictDoUpdate({
          target: [calendarAllowlist.provider, calendarAllowlist.memberId, calendarAllowlist.calendarId],
          set: { calendarName: c.name, updatedAt: new Date() },
        });
    }

    return tx.select().from(calendarAllowlist)
      .where(and(eq(calendarAllowlist.memberId, memberId), eq(calendarAllowlist.provider, provider)))
      .orderBy(asc(calendarAllowlist.calendarName));
  });
}

/** Every allowlisted calendar, across members, as sync feeds. */
export async function listAllowlistedCalendarFeeds(provider?: string): Promise<CalendarAllowlistFeed[]> {
  const rows = provider
    ? await db.select().from(calendarAllowlist).where(eq(calendarAllowlist.provider, provider))
    : await db.select().from(calendarAllowlist);
  return rows.map(toFeed);
}

/**
 * Resolve a feed from its key by MATCHING WHOLE KEYS, never by parsing.
 *
 * A calendar id can contain colons (Google's are email-shaped), so a positional
 * parse of `<provider>:calendar:member:<memberId>:<calendarId>` is unsafe. The
 * provider needs this lookup anyway — it reads the row for `is_household`.
 */
export async function getCalendarFeedByKey(feedKey: string): Promise<CalendarAllowlistFeed | null> {
  const rows = await db.select().from(calendarAllowlist);
  return rows.map(toFeed).find((f) => f.feedKey === feedKey) ?? null;
}

/** The designated household calendar feed, or null when none is designated. */
export async function getHouseholdCalendar(): Promise<CalendarAllowlistFeed | null> {
  const [row] = await db.select().from(calendarAllowlist)
    .where(eq(calendarAllowlist.isHousehold, true)).limit(1);
  return row ? toFeed(row) : null;
}

/**
 * Designate one allowlisted calendar as the household calendar.
 *
 * Clearing every other flag and setting the new one happen in ONE transaction:
 * the partial unique index would reject the update otherwise, and a
 * non-transactional clear-then-set could leave the household with none.
 *
 * The affected feeds' sync tokens are cleared in the same transaction. Every
 * mirrored row's attribution (`memberId`, family vs. member) changes with the
 * flag, and only a full re-pull rewrites them — an incremental replay would
 * leave the old attribution on every event it does not happen to re-deliver.
 */
export async function setHouseholdCalendar(
  memberId: string, provider: string, calendarId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const previouslyFlagged = await tx.select().from(calendarAllowlist)
      .where(eq(calendarAllowlist.isHousehold, true));

    await tx.update(calendarAllowlist)
      .set({ isHousehold: false, updatedAt: new Date() })
      .where(eq(calendarAllowlist.isHousehold, true));
    await tx.update(calendarAllowlist)
      .set({ isHousehold: true, updatedAt: new Date() })
      .where(and(
        eq(calendarAllowlist.memberId, memberId),
        eq(calendarAllowlist.provider, provider),
        eq(calendarAllowlist.calendarId, calendarId),
      ));

    const affected = [
      ...previouslyFlagged.map((r) => feedKeys.calendarList(r.provider, r.memberId, r.calendarId)),
      feedKeys.calendarList(provider, memberId, calendarId),
    ];
    for (const feedKey of affected) {
      await tx.update(integrationSyncState)
        .set({ syncToken: null, lastFullSyncAt: null, updatedAt: new Date() })
        .where(eq(integrationSyncState.feedKey, feedKey));
    }
  });
}
```

- [ ] **Step 6: Generate and INSPECT the migration**

Run: `npm run db:generate -- --name calendar_allowlist`
Expected: `src/db/migrations/0027_calendar_allowlist.sql` plus a journal entry (idx 27).

Open the generated SQL and confirm it is a plain `CREATE TABLE` for `calendar_allowlist` with the unique constraint, the member index, and the PARTIAL unique index (`WHERE "is_household"`). It must touch no other table. If drizzle emitted anything else, stop and report rather than hand-editing a snapshot.

- [ ] **Step 7: Run the tests**

Run: `npx vitest run tests/calendar-allowlist.test.ts && npm run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add src/modules/calendar/allowlist-schema.ts src/modules/calendar/allowlist-store.ts \
        src/db/schema/drizzle-schema.ts src/db/schema/index.ts src/db/migrations tests/calendar-allowlist.test.ts
git commit -m "feat(calendar): add the per-member calendar allowlist and household designation"
```

---

### Task 6: Calendar discovery service and routes

**Files:**
- Modify: `src/modules/calendar/providers/types.ts`, `src/m365/calendar-provider.ts`, `src/modules/calendar/service.ts`, `src/modules/calendar/routes.ts`, `src/modules/calendar/validators.ts`
- Test: `tests/calendar-allowlist-routes.test.ts`

**Interfaces:**
- Consumes: the store from Task 5; `listProviders` (`src/integrations/registry.js`); `assertNotMaintenanceAdmin` (`src/household/maintenance-admin.js`).
- Produces:
  - Contract addition: `interface AvailableCalendar { id: string; name: string }` and `CalendarProvider.listAvailableCalendars(memberId: string): Promise<AvailableCalendar[]>`.
  - Service: `interface AvailableCalendarView { provider: string; id: string; name: string; enabled: boolean; isHousehold: boolean }`, `class UnknownCalendarError extends Error`, `listAvailableCalendars(memberId)`, `setCalendarAllowlistFor(memberId, entries: Array<{ provider: string; calendarId: string }>)`, `designateHouseholdCalendar(memberId, provider, calendarId)`, `getHouseholdCalendarView()`.
  - Routes: `GET /api/v1/calendar/calendars`, `PUT /api/v1/calendar/allowlist`, `PUT /api/v1/calendar/household-calendar`.

- [ ] **Step 1: Extend the provider contract**

In `src/modules/calendar/providers/types.ts`, above `interface CalendarProvider`:

```ts
/** One calendar a member can choose to mirror (from discovery). */
export interface AvailableCalendar {
  id: string;
  name: string;
}
```

and inside `interface CalendarProvider`, after `listFeeds()`:

```ts
  /**
   * Discover the calendars a member can choose to mirror (delegated). A
   * provider whose feeds are not member-selectable returns an empty list — the
   * Graph provider does, because its feeds come from connections and the
   * configured family mailbox rather than from a pick list.
   */
  listAvailableCalendars(memberId: string): Promise<AvailableCalendar[]>;
```

In `src/m365/calendar-provider.ts`, add to `GraphCalendarProvider` right after `listFeeds` (and import `AvailableCalendar` with the other contract types):

```ts
  /**
   * M365 calendar feeds are not member-selectable: a member's default calendar
   * plus the configured family mailbox is the whole set (see `listFeeds`).
   * Returning an empty list keeps the picker honest rather than offering
   * choices that would change nothing.
   */
  async listAvailableCalendars(): Promise<AvailableCalendar[]> {
    return [];
  }
```

- [ ] **Step 2: Write the failing test**

Create `tests/calendar-allowlist-routes.test.ts`. Copy the app import and request style verbatim from `tests/integrations-routes.test.ts` — use whatever that suite imports, not a guess:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { seedTestHousehold, authHeaders } from './helpers.js';
import { app } from '../src/app.js';
import { clearProviders, registerProvider } from '../src/integrations/registry.js';
import { IntegrationStore } from '../src/integrations/store.js';
import type { AvailableCalendar, CalendarProvider } from '../src/modules/calendar/providers/types.js';

function fakeCalendarProvider(id: string, calendars: AvailableCalendar[]): CalendarProvider {
  return {
    source: id,
    listFeeds: async () => [],
    listAvailableCalendars: async () => calendars,
    pullChanges: async () => ({ upserts: [], deletions: [], masterPurges: [], nextToken: null, fullResync: true }),
  };
}

function registerFakeCalendarProvider(id: string, calendar: CalendarProvider): void {
  registerProvider({
    id, store: new IntegrationStore(id),
    classifyError: () => 'error', fullResyncIntervalMs: 1000,
    authorizeUrl: () => `https://${id}.test`,
    completeConnect: async () => ({ accountLabel: `a@${id}`, refreshToken: 'r', scopes: '' }),
    calendar, tasks: null,
    runCalendarSync: async () => [], runTaskSync: async () => [],
  });
}

beforeEach(() => { clearProviders(); });
afterEach(() => { clearProviders(); });

describe('GET /api/v1/calendar/calendars', () => {
  it("lists every registered provider's calendars, tagged and flagged", async () => {
    const { adult } = await seedTestHousehold();
    registerFakeCalendarProvider('google', fakeCalendarProvider('google', [
      { id: 'cal-a', name: 'Anna' }, { id: 'cal-b', name: 'Sport' },
    ]));

    const res = await app.request('/api/v1/calendar/calendars', { headers: authHeaders(adult.jwt) });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(body.data).toEqual([
      { provider: 'google', id: 'cal-a', name: 'Anna', enabled: false, isHousehold: false },
      { provider: 'google', id: 'cal-b', name: 'Sport', enabled: false, isHousehold: false },
    ]);
  });

  it('returns an empty list, not an error, when no provider is registered', async () => {
    const { adult } = await seedTestHousehold();
    const res = await app.request('/api/v1/calendar/calendars', { headers: authHeaders(adult.jwt) });
    expect(res.status).toBe(200);
    expect((await res.json() as { data: unknown[] }).data).toEqual([]);
  });
});

describe('PUT /api/v1/calendar/allowlist', () => {
  it('persists a selection and reports it back as enabled', async () => {
    const { adult } = await seedTestHousehold();
    registerFakeCalendarProvider('google', fakeCalendarProvider('google', [{ id: 'cal-a', name: 'Anna' }]));

    const put = await app.request('/api/v1/calendar/allowlist', {
      method: 'PUT', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ calendars: [{ provider: 'google', calendarId: 'cal-a' }] }),
    });
    expect(put.status).toBe(200);

    const res = await app.request('/api/v1/calendar/calendars', { headers: authHeaders(adult.jwt) });
    const body = await res.json() as { data: Array<{ enabled: boolean }> };
    expect(body.data[0]!.enabled).toBe(true);
  });

  it('rejects a calendar the member cannot actually access', async () => {
    const { adult } = await seedTestHousehold();
    registerFakeCalendarProvider('google', fakeCalendarProvider('google', [{ id: 'cal-a', name: 'Anna' }]));
    const res = await app.request('/api/v1/calendar/allowlist', {
      method: 'PUT', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ calendars: [{ provider: 'google', calendarId: 'not-mine' }] }),
    });
    expect(res.status).toBe(409);
    expect((await res.json() as { error: { code: string } }).error.code).toBe('UNKNOWN_CALENDAR');
  });
});

describe('PUT /api/v1/calendar/household-calendar', () => {
  it('is refused for a child', async () => {
    const { child } = await seedTestHousehold();
    const res = await app.request('/api/v1/calendar/household-calendar', {
      method: 'PUT', headers: authHeaders(child.jwt),
      body: JSON.stringify({ provider: 'google', calendarId: 'cal-a' }),
    });
    expect(res.status).toBe(403);
  });

  it('designates an allowlisted calendar for an adult', async () => {
    const { adult } = await seedTestHousehold();
    registerFakeCalendarProvider('google', fakeCalendarProvider('google', [{ id: 'cal-a', name: 'Anna' }]));
    await app.request('/api/v1/calendar/allowlist', {
      method: 'PUT', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ calendars: [{ provider: 'google', calendarId: 'cal-a' }] }),
    });

    const res = await app.request('/api/v1/calendar/household-calendar', {
      method: 'PUT', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ provider: 'google', calendarId: 'cal-a' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { calendarId: string } | null };
    expect(body.data!.calendarId).toBe('cal-a');
  });

  it('refuses to designate a calendar that is not allowlisted', async () => {
    const { adult } = await seedTestHousehold();
    const res = await app.request('/api/v1/calendar/household-calendar', {
      method: 'PUT', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ provider: 'google', calendarId: 'cal-a' }),
    });
    expect(res.status).toBe(409);
    expect((await res.json() as { error: { code: string } }).error.code).toBe('UNKNOWN_CALENDAR');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/calendar-allowlist-routes.test.ts`
Expected: FAIL — `/api/v1/calendar/calendars` resolves against `/:id` and 404s.

- [ ] **Step 4: Add the validators**

Append to `src/modules/calendar/validators.ts`:

```ts
export const setCalendarAllowlistSchema = z.object({
  calendars: z.array(z.object({
    provider: z.string().min(1),
    calendarId: z.string().min(1),
  })).default([]),
});

export const setHouseholdCalendarSchema = z.object({
  provider: z.string().min(1),
  calendarId: z.string().min(1),
});
```

- [ ] **Step 5: Add the service functions**

Append to `src/modules/calendar/service.ts` (add imports at the top: `assertNotMaintenanceAdmin` from `../../household/maintenance-admin.js`, `listProviders` from `../../integrations/registry.js`, the allowlist-store functions and its two types, and `AvailableCalendar` from `./providers/types.js`):

```ts
/**
 * Calendar discovery + allowlist management. The shape deliberately mirrors the
 * tasks module's list picker: every entry is tagged with its provider, so the
 * picker can group them and `setCalendarAllowlistFor` knows which provider a
 * chosen calendar belongs to.
 */
export interface AvailableCalendarView {
  provider: string;
  id: string;
  name: string;
  enabled: boolean;
  isHousehold: boolean;
}

/** Thrown for a calendar the member cannot access or has not allowlisted. */
export class UnknownCalendarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnknownCalendarError';
  }
}

export async function listAvailableCalendars(memberId: string): Promise<AvailableCalendarView[]> {
  await assertNotMaintenanceAdmin(memberId);
  const out: AvailableCalendarView[] = [];
  for (const p of listProviders()) {
    if (!p.calendar) continue;
    // One provider being unreachable must not hide another's calendars — the
    // same rule the tasks picker learned the hard way in Phase 1.
    let calendars: AvailableCalendar[];
    try {
      calendars = await p.calendar.listAvailableCalendars(memberId);
    } catch (e) {
      if (p.classifyError(e) === 'no_connection') continue;
      throw e;
    }
    const rows = await getCalendarAllowlist(memberId, p.id);
    const byId = new Map(rows.map((r) => [r.calendarId, r]));
    for (const c of calendars) {
      const row = byId.get(c.id);
      out.push({
        provider: p.id, id: c.id, name: c.name,
        enabled: row !== undefined, isHousehold: row?.isHousehold ?? false,
      });
    }
  }
  return out;
}

/**
 * Replace the member's calendar selection. Scoped per provider: a provider
 * whose discovery failed with `no_connection` keeps its rows untouched, so a
 * temporarily unreachable account cannot silently wipe a selection the member
 * never saw in the picker.
 */
export async function setCalendarAllowlistFor(
  memberId: string, entries: Array<{ provider: string; calendarId: string }>,
): Promise<CalendarAllowlistRow[]> {
  await assertNotMaintenanceAdmin(memberId);
  const out: CalendarAllowlistRow[] = [];
  for (const p of listProviders()) {
    if (!p.calendar) continue;
    let available: AvailableCalendar[];
    try {
      available = await p.calendar.listAvailableCalendars(memberId);
    } catch (e) {
      if (p.classifyError(e) === 'no_connection') continue;
      throw e;
    }
    const byId = new Map(available.map((c) => [c.id, c.name]));
    const selected: Array<{ id: string; name: string | null }> = [];
    for (const entry of entries.filter((e) => e.provider === p.id)) {
      if (!byId.has(entry.calendarId)) {
        throw new UnknownCalendarError(`Calendar not accessible for this member: ${entry.calendarId}`);
      }
      selected.push({ id: entry.calendarId, name: byId.get(entry.calendarId) ?? null });
    }
    out.push(...await setCalendarAllowlist(memberId, p.id, selected));
  }
  return out;
}

/**
 * Designate the household calendar. It must already be allowlisted —
 * designating an unsynced calendar would produce a family feed nothing pulls.
 */
export async function designateHouseholdCalendar(
  memberId: string, provider: string, calendarId: string,
): Promise<void> {
  const owned = await getCalendarAllowlist(memberId, provider);
  if (!owned.some((r) => r.calendarId === calendarId)) {
    throw new UnknownCalendarError(
      "That calendar is not in the member's allowlist — allowlist it before designating it",
    );
  }
  await setHouseholdCalendar(memberId, provider, calendarId);
}

export async function getHouseholdCalendarView(): Promise<CalendarAllowlistFeed | null> {
  return getHouseholdCalendar();
}
```

- [ ] **Step 6: Add the routes**

In `src/modules/calendar/routes.ts`, insert these BEFORE `calendarRouter.get('/:id', …)` and import the two new validators:

```ts
/**
 * Calendar discovery + allowlist, the sibling of `/api/v1/tasks/lists` and
 * `/api/v1/tasks/allowlist`. Registered above `/:id` deliberately: Hono matches
 * in registration order, so `/calendars` would otherwise be read as an event id.
 */
calendarRouter.get('/calendars', async (c) => {
  try {
    return ok(c, await service.listAvailableCalendars(c.get('auth').userId));
  } catch (e) {
    if (e instanceof service.UnknownCalendarError) return err(c, 'UNKNOWN_CALENDAR', e.message, 409);
    throw e;
  }
});

calendarRouter.put('/allowlist', async (c) => {
  const body = setCalendarAllowlistSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  try {
    return ok(c, await service.setCalendarAllowlistFor(c.get('auth').userId, body.data.calendars));
  } catch (e) {
    if (e instanceof service.UnknownCalendarError) return err(c, 'UNKNOWN_CALENDAR', e.message, 409);
    throw e;
  }
});

/** Designate the shared family calendar (admin or adult — a household-wide setting). */
calendarRouter.put('/household-calendar', async (c) => {
  const auth = c.get('auth');
  if (auth.role !== 'admin' && auth.role !== 'adult') {
    return err(c, 'FORBIDDEN', 'Only an adult can set the household calendar', 403);
  }
  const body = setHouseholdCalendarSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  try {
    await service.designateHouseholdCalendar(auth.userId, body.data.provider, body.data.calendarId);
    return ok(c, await service.getHouseholdCalendarView());
  } catch (e) {
    if (e instanceof service.UnknownCalendarError) return err(c, 'UNKNOWN_CALENDAR', e.message, 409);
    throw e;
  }
});
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run tests/calendar-allowlist-routes.test.ts tests/calendar-routes.test.ts tests/m365-calendar-sync.test.ts && npm run typecheck`
Expected: PASS, typecheck clean. `calendar-routes.test.ts` must stay green untouched — if `/calendars` shadowed an existing route, that suite is what says so.

- [ ] **Step 8: Commit**

```bash
git add src/modules/calendar src/m365/calendar-provider.ts tests/calendar-allowlist-routes.test.ts
git commit -m "feat(calendar): add provider-aware calendar discovery and allowlist routes"
```

---

### Task 7: `GoogleCalendarProvider`

**Files:**
- Create: `src/google/calendar-provider.ts`
- Modify: `tests/fake-google.ts` (add the Calendar endpoints)
- Test: `tests/google-calendar-sync.test.ts`

**Interfaces:**
- Consumes: `GoogleRuntime` (Task 4), `GOOGLE_CALENDAR_BASE` / `GoogleApiError` (Task 2), the allowlist store (Task 5), `CalendarProvider` / `CalendarFeed` / `MirroredEvent` / `PullResult` / `AvailableCalendar` (Task 6's extended contract), `zonedMidnightUtc` (`src/lib/local-date.js`), `getHouseholdTimeZone` (`src/household/timezone.js`).
- Produces: `class GoogleCalendarProvider implements CalendarProvider { readonly source = 'google'; constructor(rt: GoogleRuntime, resolveTimeZone?: () => Promise<string>) }`.
- Fake additions: `FakeGoogle.calendars: Map<string, FakeGoogleCalendar[]>` (discovery), `FakeGoogle.events: Map<string, FakeGoogleEventBatch[]>` (per calendarId), `setCalendars(list)`, `setEvents(calendarId, batches)`, `failEvents: Set<string>`.

- [ ] **Step 1: Extend the fake with Calendar endpoints**

Append to `tests/fake-google.ts` — new interfaces, new state fields, and the two route handlers:

```ts
/** A scripted calendar from `calendarList`. */
export interface FakeGoogleCalendar {
  id: string;
  summary: string;
}

/** A scripted event as `events.list` returns it (singleEvents=true). */
export interface FakeGoogleEvent {
  id: string;
  summary?: string;
  /** RFC3339 instant; omit together with `endUtc` for an all-day event. */
  startUtc?: string;
  endUtc?: string;
  /** All-day: inclusive start date and Google's EXCLUSIVE end date. */
  startDate?: string;
  endDate?: string;
  timeZone?: string;
  location?: string;
  organizer?: string;
  recurringEventId?: string;
  status?: 'confirmed' | 'cancelled';
}

/** One events.list "batch" = what one syncToken returns. `gone` → 410. */
export interface FakeGoogleEventBatch {
  pages: Array<{ events?: FakeGoogleEvent[] }>;
  gone?: boolean;
}
```

Add to the `FakeGoogle` interface and to the `state` literal in `createFakeGoogle`:

```ts
  /** Calendars returned by GET /calendar/v3/users/me/calendarList. */
  calendars: FakeGoogleCalendar[];
  /** Scripted events.list batches, keyed by calendarId. */
  events: Map<string, FakeGoogleEventBatch[]>;
  /** calendarIds whose next events.list returns a 500. */
  failEvents: Set<string>;
  setCalendars(list: FakeGoogleCalendar[]): void;
  setEvents(calendarId: string, batches: FakeGoogleEventBatch[]): void;
```

```ts
    calendars: [],
    events: new Map(),
    failEvents: new Set(),
    setCalendars(list) { state.calendars = list; },
    setEvents(calendarId, batches) { state.events.set(calendarId, batches); },
```

And the handlers, before `return state;`:

```ts
  // GET /calendar/v3/users/me/calendarList — discovery.
  state.app.get('/calendar/v3/users/me/calendarList', (c) => {
    state.calls.push({ method: 'GET', path: '/calendar/v3/users/me/calendarList' });
    return c.json({ items: state.calendars.map((cal) => ({ id: cal.id, summary: cal.summary })) });
  });

  // GET /calendar/v3/calendars/:calendarId/events — full or incremental pull.
  state.app.get('/calendar/v3/calendars/:calendarId/events', (c) => {
    const calendarId = decodeURIComponent(c.req.param('calendarId'));
    const url = new URL(c.req.url);
    state.calls.push({ method: 'GET', path: url.pathname, query: url.search.replace(/^\?/, '') });

    if (state.failEvents.has(calendarId)) {
      return c.json({ error: { code: 500, message: 'backendError' } }, 500);
    }

    const batches = state.events.get(calendarId) ?? [];
    // Token encodes "<batchIndex>.<pageIndex>", the same trick fake-graph uses.
    const token = c.req.query('syncToken') ?? c.req.query('pageToken');
    let bi = 0;
    let pi = 0;
    if (token) { const [b, p] = token.split('.'); bi = Number(b); pi = Number(p); }

    const batch = batches[bi];
    if (batch?.gone) {
      return c.json({ error: { code: 410, message: 'Sync token is no longer valid', errors: [{ reason: 'fullSyncRequired' }] } }, 410);
    }
    if (!batch) {
      return c.json({ items: [], nextSyncToken: `${bi}.0` });
    }

    const page = batch.pages[pi] ?? {};
    const items = (page.events ?? []).map((e) => ({
      id: e.id,
      status: e.status ?? 'confirmed',
      summary: e.summary,
      start: e.startDate ? { date: e.startDate } : { dateTime: e.startUtc, timeZone: e.timeZone ?? 'UTC' },
      end: e.endDate ? { date: e.endDate } : { dateTime: e.endUtc, timeZone: e.timeZone ?? 'UTC' },
      ...(e.location ? { location: e.location } : {}),
      ...(e.organizer ? { organizer: { displayName: e.organizer } } : {}),
      ...(e.recurringEventId ? { recurringEventId: e.recurringEventId } : {}),
    }));
    const hasMorePages = pi + 1 < batch.pages.length;
    if (hasMorePages) return c.json({ items, nextPageToken: `${bi}.${pi + 1}` });
    return c.json({ items, nextSyncToken: `${bi + 1}.0` });
  });
```

- [ ] **Step 2: Write the failing test**

Create `tests/google-calendar-sync.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { seedTestHousehold } from './helpers.js';
import { createFakeGoogle, runtimeForFakeGoogle, type FakeGoogle } from './fake-google.js';
import { GoogleCalendarProvider } from '../src/google/calendar-provider.js';
import {
  setCalendarAllowlist, setHouseholdCalendar,
} from '../src/modules/calendar/allowlist-store.js';
import type { GoogleRuntime } from '../src/google/runtime.js';

let fake: FakeGoogle;
let rt: GoogleRuntime;
// A fixed household zone keeps the all-day and date-only assertions deterministic.
const provider = () => new GoogleCalendarProvider(rt, async () => 'Europe/Berlin');

beforeEach(() => {
  fake = createFakeGoogle();
  rt = runtimeForFakeGoogle(fake);
});

async function connectedMember() {
  const { adult } = await seedTestHousehold();
  await rt.store.upsertConnection({
    memberId: adult.user.id, accountLabel: 'a@gmail.test', refreshToken: 'r', scopes: '',
  });
  return adult.user.id;
}

describe('GoogleCalendarProvider.listAvailableCalendars', () => {
  it('reports the member\'s calendars', async () => {
    const memberId = await connectedMember();
    fake.setCalendars([{ id: 'cal-a', summary: 'Anna' }, { id: 'cal-b', summary: 'Sport' }]);
    expect(await provider().listAvailableCalendars(memberId)).toEqual([
      { id: 'cal-a', name: 'Anna' }, { id: 'cal-b', name: 'Sport' },
    ]);
  });
});

describe('GoogleCalendarProvider.listFeeds', () => {
  it('enumerates allowlisted calendars only, as member feeds', async () => {
    const memberId = await connectedMember();
    await setCalendarAllowlist(memberId, 'google', [{ id: 'cal-a', name: 'Anna' }]);
    expect(await provider().listFeeds()).toEqual([
      { feedKey: `google:calendar:member:${memberId}:cal-a`, memberId, kind: 'member' },
    ]);
  });

  it('reports the designated calendar as a FAMILY feed still owned by its member', async () => {
    const memberId = await connectedMember();
    await setCalendarAllowlist(memberId, 'google', [{ id: 'cal-a', name: 'Anna' }]);
    await setHouseholdCalendar(memberId, 'google', 'cal-a');
    const [feed] = await provider().listFeeds();
    // kind drives attribution; memberId stays set because the pull runs on THAT
    // member's delegated token and the runner needs it for the health check.
    expect(feed).toEqual({ feedKey: `google:calendar:member:${memberId}:cal-a`, memberId, kind: 'family' });
  });
});

describe('GoogleCalendarProvider.pullChanges', () => {
  it('does a windowed full pull with no token, and mirrors normalized events', async () => {
    const memberId = await connectedMember();
    await setCalendarAllowlist(memberId, 'google', [{ id: 'cal-a', name: 'Anna' }]);
    fake.setEvents('cal-a', [{ pages: [{ events: [{
      id: 'ev-1', summary: 'Dentist', startUtc: '2026-09-01T09:00:00Z', endUtc: '2026-09-01T10:00:00Z',
      location: 'Praxis', organizer: 'Anna', timeZone: 'Europe/Berlin',
    }] }] }]);

    const out = await provider().pullChanges(`google:calendar:member:${memberId}:cal-a`, null);

    expect(out.fullResync).toBe(true);
    expect(out.masterPurges).toEqual([]);
    expect(out.upserts).toEqual([{
      externalId: 'ev-1', title: 'Dentist',
      start: { utc: '2026-09-01T09:00:00.000Z', timeZone: 'Europe/Berlin' },
      end: { utc: '2026-09-01T10:00:00.000Z', timeZone: 'Europe/Berlin' },
      allDay: false, location: 'Praxis', organizer: 'Anna', memberId, seriesMasterId: null,
    }]);
    const call = fake.calls.find((c) => c.path.includes('/events'))!;
    expect(call.query).toContain('singleEvents=true');
    expect(call.query).toContain('timeMin=');
  });

  it('replays the sync token WITHOUT a window on an incremental pull', async () => {
    const memberId = await connectedMember();
    await setCalendarAllowlist(memberId, 'google', [{ id: 'cal-a', name: 'Anna' }]);
    fake.setEvents('cal-a', [{ pages: [{ events: [] }] }, { pages: [{ events: [] }] }]);

    const out = await provider().pullChanges(`google:calendar:member:${memberId}:cal-a`, '1.0');

    expect(out.fullResync).toBe(false);
    const call = fake.calls.filter((c) => c.path.includes('/events')).at(-1)!;
    // Google rejects timeMin/timeMax alongside a syncToken with a 400.
    expect(call.query).toContain('syncToken=1.0');
    expect(call.query).not.toContain('timeMin=');
  });

  it('maps a cancelled event to a deletion', async () => {
    const memberId = await connectedMember();
    await setCalendarAllowlist(memberId, 'google', [{ id: 'cal-a', name: 'Anna' }]);
    fake.setEvents('cal-a', [{ pages: [{ events: [
      { id: 'ev-gone', status: 'cancelled' },
      { id: 'ev-live', summary: 'Live', startUtc: '2026-09-02T09:00:00Z', endUtc: '2026-09-02T10:00:00Z' },
    ] }] }]);

    const out = await provider().pullChanges(`google:calendar:member:${memberId}:cal-a`, null);
    expect(out.deletions).toEqual(['ev-gone']);
    expect(out.upserts.map((e) => e.externalId)).toEqual(['ev-live']);
  });

  it('anchors an all-day event to household-local midnight and flags allDay', async () => {
    const memberId = await connectedMember();
    await setCalendarAllowlist(memberId, 'google', [{ id: 'cal-a', name: 'Anna' }]);
    fake.setEvents('cal-a', [{ pages: [{ events: [
      { id: 'ev-holiday', summary: 'Ferien', startDate: '2026-09-05', endDate: '2026-09-06' },
    ] }] }]);

    const [ev] = (await provider().pullChanges(`google:calendar:member:${memberId}:cal-a`, null)).upserts;
    expect(ev!.allDay).toBe(true);
    // Berlin is UTC+2 in September: local midnight is 22:00Z the day before.
    expect(ev!.start.utc).toBe('2026-09-04T22:00:00.000Z');
    expect(ev!.end.utc).toBe('2026-09-05T22:00:00.000Z');
  });

  it('carries recurringEventId across as seriesMasterId and never emits a master purge', async () => {
    const memberId = await connectedMember();
    await setCalendarAllowlist(memberId, 'google', [{ id: 'cal-a', name: 'Anna' }]);
    fake.setEvents('cal-a', [{ pages: [{ events: [
      { id: 'ev-occ', summary: 'Turnen', startUtc: '2026-09-03T15:00:00Z', endUtc: '2026-09-03T16:00:00Z',
        recurringEventId: 'series-1' },
    ] }] }]);

    const out = await provider().pullChanges(`google:calendar:member:${memberId}:cal-a`, null);
    expect(out.upserts[0]!.seriesMasterId).toBe('series-1');
    // singleEvents=true means Google never delivers a series master, so the
    // Graph-specific hazard masterPurges exists for cannot arise here.
    expect(out.masterPurges).toEqual([]);
  });

  it('attributes the designated household feed to no member', async () => {
    const memberId = await connectedMember();
    await setCalendarAllowlist(memberId, 'google', [{ id: 'cal-a', name: 'Anna' }]);
    await setHouseholdCalendar(memberId, 'google', 'cal-a');
    fake.setEvents('cal-a', [{ pages: [{ events: [
      { id: 'ev-1', summary: 'Müllabfuhr', startUtc: '2026-09-01T06:00:00Z', endUtc: '2026-09-01T06:30:00Z' },
    ] }] }]);

    const out = await provider().pullChanges(`google:calendar:member:${memberId}:cal-a`, null);
    expect(out.upserts[0]!.memberId).toBeNull();
  });

  it('recovers from a 410 by re-windowing and reporting a full resync', async () => {
    const memberId = await connectedMember();
    await setCalendarAllowlist(memberId, 'google', [{ id: 'cal-a', name: 'Anna' }]);
    fake.setEvents('cal-a', [
      { pages: [{ events: [{ id: 'ev-fresh', summary: 'Fresh', startUtc: '2026-09-01T09:00:00Z', endUtc: '2026-09-01T10:00:00Z' }] }] },
      { pages: [], gone: true },
    ]);

    const out = await provider().pullChanges(`google:calendar:member:${memberId}:cal-a`, '1.0');
    expect(out.fullResync).toBe(true);
    expect(out.upserts.map((e) => e.externalId)).toEqual(['ev-fresh']);
  });

  it('follows nextPageToken to exhaustion', async () => {
    const memberId = await connectedMember();
    await setCalendarAllowlist(memberId, 'google', [{ id: 'cal-a', name: 'Anna' }]);
    fake.setEvents('cal-a', [{ pages: [
      { events: [{ id: 'ev-1', summary: 'One', startUtc: '2026-09-01T09:00:00Z', endUtc: '2026-09-01T10:00:00Z' }] },
      { events: [{ id: 'ev-2', summary: 'Two', startUtc: '2026-09-02T09:00:00Z', endUtc: '2026-09-02T10:00:00Z' }] },
    ] }]);

    const out = await provider().pullChanges(`google:calendar:member:${memberId}:cal-a`, null);
    expect(out.upserts.map((e) => e.externalId)).toEqual(['ev-1', 'ev-2']);
    expect(out.nextToken).toBe('1.0');
  });

  it('refuses a feed key with no allowlist row', async () => {
    const memberId = await connectedMember();
    await expect(
      provider().pullChanges(`google:calendar:member:${memberId}:not-allowlisted`, null),
    ).rejects.toThrow(/Unknown Google calendar feed/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/google-calendar-sync.test.ts`
Expected: FAIL — cannot resolve `../src/google/calendar-provider.js`.

- [ ] **Step 4: Write the implementation**

Create `src/google/calendar-provider.ts`:

```ts
import type { GoogleRuntime } from './runtime.js';
import { GoogleApiError, GOOGLE_CALENDAR_BASE } from './api.js';
import { zonedMidnightUtc } from '../lib/local-date.js';
import { getHouseholdTimeZone } from '../household/timezone.js';
import {
  getCalendarFeedByKey, listAllowlistedCalendarFeeds,
} from '../modules/calendar/allowlist-store.js';
import type {
  AvailableCalendar, CalendarFeed, CalendarProvider, MirroredEvent, PullResult,
} from '../modules/calendar/providers/types.js';

/**
 * The Google Calendar read-only mirror provider — one of the two places Google
 * Calendar types and URLs live (the other is the transport in `api.ts`).
 *
 * `events.list` with `singleEvents=true` makes Google expand recurrences
 * server-side, which is exactly what the contract asks for: we mirror expanded
 * occurrences and never reconstruct rules. Because a series master is therefore
 * never delivered, {@link PullResult.masterPurges} is ALWAYS empty here — the
 * Graph hazard that field exists for cannot arise.
 *
 * Feeds come from `calendar_allowlist`, never from Google: a disconnected or
 * de-selected member's feeds disappear naturally, matching how To Do feeds
 * already work. The row is also how a feed key is resolved back to its member
 * and calendar — this provider NEVER parses a feed key, because a Google
 * calendar id is email-shaped and a positional parse would split it.
 */

// Rolling window for a full pull. Same horizons as the Graph provider, so the
// two mirrors show the same span of household history and future.
const WINDOW_PAST_DAYS = 60;
const WINDOW_FUTURE_DAYS = 400;

// Defensive cap on a runaway pageToken chain.
const MAX_PAGES = 50;

const PAGE_SIZE = 250;

interface GoogleEventDateTime {
  /** All-day events carry `date` (YYYY-MM-DD) instead of `dateTime`. */
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

interface GoogleEvent {
  id: string;
  status?: string; // confirmed | tentative | cancelled
  summary?: string | null;
  location?: string | null;
  organizer?: { displayName?: string | null; email?: string | null } | null;
  start?: GoogleEventDateTime;
  end?: GoogleEventDateTime;
  recurringEventId?: string | null;
}

interface EventsListResponse {
  items?: GoogleEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

interface CalendarListResponse {
  items?: Array<{ id: string; summary?: string | null; summaryOverride?: string | null }>;
  nextPageToken?: string;
}

export class GoogleCalendarProvider implements CalendarProvider {
  readonly source = 'google';

  /**
   * `resolveTimeZone` supplies the household IANA zone used to anchor all-day
   * dates; defaults to the live household row, tests inject a fixed zone.
   */
  constructor(
    private readonly rt: GoogleRuntime,
    private readonly resolveTimeZone: () => Promise<string> = getHouseholdTimeZone,
  ) {}

  async listAvailableCalendars(memberId: string): Promise<AvailableCalendar[]> {
    const token = await this.rt.oauth.getAccessToken(memberId);
    const out: AvailableCalendar[] = [];
    let url = `${GOOGLE_CALENDAR_BASE}/users/me/calendarList?maxResults=250`;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await this.rt.googleFetch<CalendarListResponse>(token, url);
      for (const cal of res.items ?? []) {
        out.push({ id: cal.id, name: (cal.summaryOverride ?? cal.summary ?? '').trim() || '(untitled calendar)' });
      }
      if (!res.nextPageToken) break;
      url = `${GOOGLE_CALENDAR_BASE}/users/me/calendarList?maxResults=250&pageToken=${encodeURIComponent(res.nextPageToken)}`;
    }
    return out;
  }

  /**
   * Feeds are the allowlisted calendars. `kind` is `'family'` for the
   * designated household calendar — but `memberId` STAYS SET even then: the
   * pull runs on that member's delegated token, and the sync runner uses this
   * field for its connection health short-circuit. Only the mirrored ROWS drop
   * their member attribution (see {@link toMirrored}).
   */
  async listFeeds(): Promise<CalendarFeed[]> {
    const feeds = await listAllowlistedCalendarFeeds('google');
    return feeds.map((f) => ({
      feedKey: f.feedKey,
      memberId: f.memberId,
      kind: f.isHousehold ? 'family' : 'member',
    }));
  }

  async pullChanges(
    feedKey: string, syncToken: string | null, forceFullResync = false,
  ): Promise<PullResult> {
    const feed = await getCalendarFeedByKey(feedKey);
    if (!feed) throw new Error(`Unknown Google calendar feed: ${feedKey}`);

    const zone = await this.resolveTimeZone();
    const accessToken = await this.rt.oauth.getAccessToken(feed.memberId);
    const attributedMemberId = feed.isHousehold ? null : feed.memberId;
    const base = `${GOOGLE_CALENDAR_BASE}/calendars/${encodeURIComponent(feed.calendarId)}/events`;

    const fullResync = !syncToken || forceFullResync;
    let url = fullResync ? `${base}?${this.windowParams()}` : `${base}?${this.incrementalParams(syncToken!)}`;

    const upserts: MirroredEvent[] = [];
    const deletions: string[] = [];
    let nextToken: string | null = null;

    for (let page = 0; page < MAX_PAGES; page++) {
      let res: EventsListResponse;
      try {
        res = await this.rt.googleFetch<EventsListResponse>(accessToken, url);
      } catch (e) {
        // An expired/invalid syncToken is 410 GONE. Drop it and re-pull over a
        // freshly computed window; `deletions` cannot be trusted across the gap,
        // which is exactly what fullResync tells the store.
        if (e instanceof GoogleApiError && e.status === 410 && syncToken && !forceFullResync) {
          return this.pullChanges(feedKey, null);
        }
        throw e;
      }

      for (const ev of res.items ?? []) {
        // `cancelled` is Google's tombstone. With singleEvents=true it names a
        // single occurrence, so no cascade is needed or wanted.
        if (ev.status === 'cancelled') {
          deletions.push(ev.id);
          continue;
        }
        upserts.push(this.toMirrored(ev, attributedMemberId, zone));
      }

      if (res.nextPageToken) {
        url = fullResync
          ? `${base}?${this.windowParams()}&pageToken=${encodeURIComponent(res.nextPageToken)}`
          : `${base}?${this.incrementalParams(syncToken!)}&pageToken=${encodeURIComponent(res.nextPageToken)}`;
        continue;
      }
      nextToken = res.nextSyncToken ?? null;
      break;
    }

    return { upserts, deletions, masterPurges: [], nextToken, fullResync };
  }

  /** Query for a fresh full pull over the rolling window. */
  private windowParams(now = new Date()): string {
    const timeMin = new Date(now.getTime() - WINDOW_PAST_DAYS * 86_400_000).toISOString();
    const timeMax = new Date(now.getTime() + WINDOW_FUTURE_DAYS * 86_400_000).toISOString();
    return new URLSearchParams({
      singleEvents: 'true',
      showDeleted: 'true',
      maxResults: String(PAGE_SIZE),
      timeMin,
      timeMax,
    }).toString();
  }

  /**
   * Query for an incremental pull. Deliberately WITHOUT timeMin/timeMax:
   * Google rejects a syncToken sent alongside them with a 400, because the
   * token already encodes the window the first request established.
   */
  private incrementalParams(syncToken: string): string {
    return new URLSearchParams({
      singleEvents: 'true',
      showDeleted: 'true',
      maxResults: String(PAGE_SIZE),
      syncToken,
    }).toString();
  }

  private toMirrored(ev: GoogleEvent, memberId: string | null, zone: string): MirroredEvent {
    const allDay = ev.start?.date !== undefined;
    return {
      externalId: ev.id,
      title: ev.summary?.trim() || '(untitled)',
      start: this.toInstant(ev.start, zone),
      // Google's all-day `end.date` is EXCLUSIVE (the day after the last day),
      // which is the same convention Graph uses — carried across unchanged.
      end: this.toInstant(ev.end, zone),
      allDay,
      location: ev.location?.trim() || null,
      organizer: ev.organizer?.displayName?.trim() || ev.organizer?.email?.trim() || null,
      memberId,
      seriesMasterId: ev.recurringEventId ?? null,
    };
  }

  /**
   * A `dateTime` is already an absolute instant. A `date` is a CALENDAR DATE,
   * so it is anchored to household-local midnight — the same rule the task
   * providers apply to date-only due dates, and what makes the wall's local-day
   * bucketing land on the intended day.
   */
  private toInstant(dt: GoogleEventDateTime | undefined, zone: string): { utc: string; timeZone: string | null } {
    if (dt?.dateTime) {
      return { utc: new Date(dt.dateTime).toISOString(), timeZone: dt.timeZone ?? null };
    }
    if (dt?.date) {
      return { utc: zonedMidnightUtc(dt.date, zone).toISOString(), timeZone: dt.timeZone ?? zone };
    }
    // Google always sends one or the other for a non-cancelled event; a missing
    // value would be a malformed payload, so fail loudly rather than mirror a
    // wrong instant.
    throw new Error('Google event carried neither start/end dateTime nor date');
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/google-calendar-sync.test.ts && npm run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 6: Prove the incremental-window guard bites**

Temporarily make `incrementalParams` include `timeMin`, re-run the suite, and confirm "replays the sync token WITHOUT a window" fails. Restore it. This is the assertion standing in for Google's 400.

- [ ] **Step 7: Commit**

```bash
git add src/google/calendar-provider.ts tests/fake-google.ts tests/google-calendar-sync.test.ts
git commit -m "feat(google): add the Google Calendar mirror provider"
```

---

### Task 8: Google calendar sync runner

**Files:**
- Create: `src/google/calendar-sync.ts`
- Test: `tests/google-calendar-sync.test.ts` (append a `describe` block)

**Interfaces:**
- Consumes: `GoogleCalendarProvider` (Task 7), `getGoogleRuntime` / `GoogleRuntime` (Task 4), `classify` / `googleFullResyncIntervalMs` (Task 3), `syncOneFeed` / `FeedSyncResult` (`src/integrations/sync-runner.js`), `applyMirrorPull` (`src/modules/calendar/mirror-store.js`).
- Produces: `runGoogleCalendarSync(rt?: GoogleRuntime, provider?: CalendarProvider): Promise<FeedSyncResult[]>`.

- [ ] **Step 1: Write the failing test**

Append to `tests/google-calendar-sync.test.ts`:

```ts
import { eq } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { calendarMirrorEvents } from '../src/modules/calendar/mirror-schema.js';
import { runGoogleCalendarSync } from '../src/google/calendar-sync.js';

describe('runGoogleCalendarSync', () => {
  it('writes the mirror and records per-feed success', async () => {
    const memberId = await connectedMember();
    await setCalendarAllowlist(memberId, 'google', [{ id: 'cal-a', name: 'Anna' }]);
    fake.setEvents('cal-a', [{ pages: [{ events: [
      { id: 'ev-1', summary: 'Dentist', startUtc: '2026-09-01T09:00:00Z', endUtc: '2026-09-01T10:00:00Z' },
    ] }] }]);

    const results = await runGoogleCalendarSync(rt, provider());
    expect(results).toEqual([{
      feedKey: `google:calendar:member:${memberId}:cal-a`, status: 'ok', upserted: 1, deleted: 0,
    }]);

    const rows = await db.select().from(calendarMirrorEvents)
      .where(eq(calendarMirrorEvents.source, 'google'));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe('Dentist');
  });

  it('skips a feed whose member has no connection', async () => {
    const { child } = await seedTestHousehold();
    await setCalendarAllowlist(child.user.id, 'google', [{ id: 'cal-x', name: 'X' }]);
    const results = await runGoogleCalendarSync(rt, provider());
    expect(results).toEqual([{
      feedKey: `google:calendar:member:${child.user.id}:cal-x`, status: 'skipped', reason: 'no_connection',
    }]);
  });

  it('classifies an upstream failure as google_<status>, never graph_<n>', async () => {
    const memberId = await connectedMember();
    await setCalendarAllowlist(memberId, 'google', [{ id: 'cal-a', name: 'Anna' }]);
    fake.failEvents.add('cal-a');

    const [result] = await runGoogleCalendarSync(rt, provider());
    expect(result).toMatchObject({ status: 'error', reason: 'google_500' });
    const state = await rt.store.getSyncState(`google:calendar:member:${memberId}:cal-a`);
    expect(state!.lastError).toBe('google_500');
  });

  it('reconciles a full pull: an event absent from the snapshot is deleted, survivors keep their id', async () => {
    const memberId = await connectedMember();
    await setCalendarAllowlist(memberId, 'google', [{ id: 'cal-a', name: 'Anna' }]);
    fake.setEvents('cal-a', [{ pages: [{ events: [
      { id: 'ev-1', summary: 'Stays', startUtc: '2026-09-01T09:00:00Z', endUtc: '2026-09-01T10:00:00Z' },
      { id: 'ev-2', summary: 'Goes', startUtc: '2026-09-02T09:00:00Z', endUtc: '2026-09-02T10:00:00Z' },
    ] }] }]);
    await runGoogleCalendarSync(rt, provider());
    const before = await db.select().from(calendarMirrorEvents)
      .where(eq(calendarMirrorEvents.externalId, 'ev-1'));

    // A second FULL pull carrying only ev-1.
    fake.setEvents('cal-a', [{ pages: [{ events: [
      { id: 'ev-1', summary: 'Stays', startUtc: '2026-09-01T09:00:00Z', endUtc: '2026-09-01T10:00:00Z' },
    ] }] }]);
    await rt.store.recordSyncSuccess(`google:calendar:member:${memberId}:cal-a`, null, false);
    await runGoogleCalendarSync(rt, provider());

    const after = await db.select().from(calendarMirrorEvents)
      .where(eq(calendarMirrorEvents.source, 'google'));
    expect(after.map((r) => r.externalId)).toEqual(['ev-1']);
    expect(after[0]!.id).toBe(before[0]!.id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/google-calendar-sync.test.ts`
Expected: FAIL — cannot resolve `../src/google/calendar-sync.js`.

- [ ] **Step 3: Write the implementation**

Create `src/google/calendar-sync.ts`:

```ts
import { getGoogleRuntime, type GoogleRuntime } from './runtime.js';
import { GoogleCalendarProvider } from './calendar-provider.js';
import { classify, googleFullResyncIntervalMs } from './sync-runner.js';
import { syncOneFeed, type FeedSyncResult } from '../integrations/sync-runner.js';
import { applyMirrorPull } from '../modules/calendar/mirror-store.js';
import type { CalendarProvider } from '../modules/calendar/providers/types.js';

/**
 * Google calendar sync runner — the sibling of `src/m365/calendar-sync.ts`.
 * Everything AROUND the pull (connection short-circuit, periodic re-window,
 * error isolation and classification, sync-state recording) is the shared
 * `syncOneFeed`; this file only enumerates feeds and wires the pull to the
 * mirror write.
 */
export async function runGoogleCalendarSync(
  rt: GoogleRuntime = getGoogleRuntime(),
  provider: CalendarProvider = new GoogleCalendarProvider(rt),
): Promise<FeedSyncResult[]> {
  const feeds = await provider.listFeeds();
  const results: FeedSyncResult[] = [];
  for (const feed of feeds) {
    results.push(await syncOneFeed(
      { store: rt.store, classifyError: classify, fullResyncIntervalMs: googleFullResyncIntervalMs() },
      feed,
      async (syncToken, forceFullResync) => {
        const result = await provider.pullChanges(feed.feedKey, syncToken, forceFullResync);
        const { upserted, deleted } = await applyMirrorPull(provider.source, feed.feedKey, result);
        return { nextToken: result.nextToken, fullResync: result.fullResync, upserted, deleted };
      },
    ));
  }
  return results;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/google-calendar-sync.test.ts tests/m365-calendar-sync.test.ts && npm run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/google/calendar-sync.ts tests/google-calendar-sync.test.ts
git commit -m "feat(google): add the Google calendar sync runner"
```

---

### Task 9: `GoogleTaskProvider` — snapshot, not delta

**Files:**
- Create: `src/google/task-provider.ts`
- Modify: `src/modules/tasks/store.ts` (add `getTaskFeedByKey`), `tests/fake-google.ts` (add the Tasks endpoints)
- Test: `tests/google-tasks-sync.test.ts`

**Interfaces:**
- Consumes: `GoogleRuntime` (Task 4), `GOOGLE_TASKS_BASE` (Task 2), `classify` (Task 3), the tasks contract (`src/modules/tasks/providers/types.js`), `localDateOf` / `zonedMidnightUtc` (`src/lib/local-date.js`), `getHouseholdTimeZone`.
- Produces:
  - `getTaskFeedByKey(feedKey: string): Promise<TaskFeed | null>` in `src/modules/tasks/store.ts`.
  - `class GoogleTaskProvider implements TaskProvider { readonly source = 'google'; constructor(rt: GoogleRuntime, resolveTimeZone?: () => Promise<string>) }`.
- Fake additions: `FakeGoogle.taskLists`, `FakeGoogle.tasks: Map<string, FakeGoogleTask[]>`, `setTaskLists`, `setTasks`, `failTasks: Set<string>`, `createdTaskCount`, `tasksPageSize`.

- [ ] **Step 1: Add the feed lookup to the tasks store**

Append to `src/modules/tasks/store.ts`, beside `listAllowlistedFeeds`:

```ts
/**
 * Resolve one task feed from its key by MATCHING WHOLE KEYS, never by parsing.
 *
 * The Graph provider parses its keys with a regex; a Google list id must not be
 * parsed that way, and the Google provider needs the row anyway (for the cached
 * list name). Building every candidate key and comparing whole is exact
 * regardless of what characters an id contains.
 */
export async function getTaskFeedByKey(feedKey: string): Promise<TaskFeed | null> {
  const feeds = await listAllowlistedFeeds();
  return feeds.find((f) => f.feedKey === feedKey) ?? null;
}
```

- [ ] **Step 2: Extend the fake with Tasks endpoints**

Append the interfaces to `tests/fake-google.ts`:

```ts
/** A scripted Google Tasks list. */
export interface FakeGoogleTaskList {
  id: string;
  title: string;
}

/** A scripted Google task, as `tasks.list` returns it. */
export interface FakeGoogleTask {
  id: string;
  title: string;
  notes?: string;
  /** Date-only in effect: Google stores UTC midnight and ignores the time. */
  due?: string;
  status?: 'needsAction' | 'completed';
  /** RFC3339 instant — Google Tasks records a real completion timestamp. */
  completed?: string;
  /** Present only in a showDeleted response; the provider must ignore these. */
  deleted?: boolean;
  hidden?: boolean;
}
```

Add to the `FakeGoogle` interface and the `state` literal:

```ts
  /** Lists returned by GET /tasks/v1/users/@me/lists. */
  taskLists: FakeGoogleTaskList[];
  /** The full current contents of each list, keyed by listId. */
  tasks: Map<string, FakeGoogleTask[]>;
  /** listIds whose next tasks.list returns a 500. */
  failTasks: Set<string>;
  /** Page size the fake paginates at (lets a test exercise pageToken). */
  tasksPageSize: number;
  /** Number of tasks created via POST. */
  createdTaskCount: number;
  setTaskLists(lists: FakeGoogleTaskList[]): void;
  setTasks(listId: string, tasks: FakeGoogleTask[]): void;
```

```ts
    taskLists: [],
    tasks: new Map(),
    failTasks: new Set(),
    tasksPageSize: 100,
    createdTaskCount: 0,
    setTaskLists(lists) { state.taskLists = lists; },
    setTasks(listId, tasks) { state.tasks.set(listId, tasks); },
```

And the handlers, before `return state;`:

```ts
  // GET /tasks/v1/users/@me/lists — list discovery.
  state.app.get('/tasks/v1/users/@me/lists', (c) => {
    state.calls.push({ method: 'GET', path: '/tasks/v1/users/@me/lists' });
    return c.json({ items: state.taskLists.map((l) => ({ id: l.id, title: l.title })) });
  });

  // GET /tasks/v1/lists/:listId/tasks — the WHOLE list, paged.
  state.app.get('/tasks/v1/lists/:listId/tasks', (c) => {
    const listId = decodeURIComponent(c.req.param('listId'));
    const url = new URL(c.req.url);
    state.calls.push({ method: 'GET', path: url.pathname, query: url.search.replace(/^\?/, '') });

    if (state.failTasks.has(listId)) {
      return c.json({ error: { code: 500, message: 'backendError' } }, 500);
    }

    const all = state.tasks.get(listId) ?? [];
    // Honour the flags the way Google does — a provider that forgets
    // showCompleted/showHidden must SEE completed tasks vanish.
    const showCompleted = c.req.query('showCompleted') === 'true';
    const showHidden = c.req.query('showHidden') === 'true';
    const visible = all.filter((t) => {
      if (t.status === 'completed' && !showCompleted) return false;
      if (t.hidden && !showHidden) return false;
      return true;
    });

    const offset = Number(c.req.query('pageToken') ?? '0');
    const page = visible.slice(offset, offset + state.tasksPageSize);
    const nextOffset = offset + state.tasksPageSize;
    return c.json({
      items: page.map((t) => ({
        id: t.id,
        title: t.title,
        ...(t.notes ? { notes: t.notes } : {}),
        ...(t.due ? { due: t.due } : {}),
        status: t.status ?? 'needsAction',
        ...(t.completed ? { completed: t.completed } : {}),
        ...(t.deleted ? { deleted: true } : {}),
        ...(t.hidden ? { hidden: true } : {}),
      })),
      ...(nextOffset < visible.length ? { nextPageToken: String(nextOffset) } : {}),
    });
  });

  // PATCH /tasks/v1/lists/:listId/tasks/:taskId — completion write-back.
  state.app.patch('/tasks/v1/lists/:listId/tasks/:taskId', async (c) => {
    const url = new URL(c.req.url);
    const body = await c.req.json().catch(() => ({})) as { status?: string };
    state.calls.push({ method: 'PATCH', path: url.pathname, body });
    return c.json({ id: c.req.param('taskId'), title: 'task', status: body.status ?? 'needsAction' });
  });

  // POST /tasks/v1/lists/:listId/tasks — creation.
  state.app.post('/tasks/v1/lists/:listId/tasks', async (c) => {
    const url = new URL(c.req.url);
    const body = await c.req.json().catch(() => ({})) as { title?: string; notes?: string; due?: string };
    state.calls.push({ method: 'POST', path: url.pathname, body });
    state.createdTaskCount += 1;
    return c.json({
      id: `google-task-created-${state.createdTaskCount}`,
      title: body.title ?? '(untitled)',
      status: 'needsAction',
      ...(body.notes ? { notes: body.notes } : {}),
      ...(body.due ? { due: body.due } : {}),
    }, 201);
  });
```

- [ ] **Step 3: Write the failing test**

Create `tests/google-tasks-sync.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { seedTestHousehold } from './helpers.js';
import { createFakeGoogle, runtimeForFakeGoogle, type FakeGoogle } from './fake-google.js';
import { GoogleTaskProvider } from '../src/google/task-provider.js';
import { setAllowlist } from '../src/modules/tasks/store.js';
import { TaskProviderError } from '../src/modules/tasks/providers/types.js';
import type { GoogleRuntime } from '../src/google/runtime.js';

let fake: FakeGoogle;
let rt: GoogleRuntime;
const provider = () => new GoogleTaskProvider(rt, async () => 'Europe/Berlin');

beforeEach(() => {
  fake = createFakeGoogle();
  rt = runtimeForFakeGoogle(fake);
});

async function connectedMemberWithList() {
  const { adult } = await seedTestHousehold();
  await rt.store.upsertConnection({
    memberId: adult.user.id, accountLabel: 'a@gmail.test', refreshToken: 'r', scopes: '',
  });
  await setAllowlist(adult.user.id, 'google', [{ id: 'list-1', name: 'Haushalt' }]);
  return { memberId: adult.user.id, feedKey: `google:todo:member:${adult.user.id}:list-1` };
}

describe('GoogleTaskProvider.listAvailableLists', () => {
  it('reports the member\'s task lists', async () => {
    const { memberId } = await connectedMemberWithList();
    fake.setTaskLists([{ id: 'list-1', title: 'Haushalt' }, { id: 'list-2', title: 'Einkauf' }]);
    expect(await provider().listAvailableLists(memberId)).toEqual([
      { id: 'list-1', name: 'Haushalt' }, { id: 'list-2', name: 'Einkauf' },
    ]);
  });

  it('wraps a failure in a classified TaskProviderError', async () => {
    const { child } = await seedTestHousehold();
    const e = await provider().listAvailableLists(child.user.id).catch((err: unknown) => err);
    expect(e).toBeInstanceOf(TaskProviderError);
    expect((e as TaskProviderError).reason).toBe('no_connection');
  });
});

describe('GoogleTaskProvider.pullChanges', () => {
  it('always reports a full snapshot and asks for completed AND hidden tasks', async () => {
    const { memberId, feedKey } = await connectedMemberWithList();
    fake.setTasks('list-1', [{ id: 't-1', title: 'Müll rausbringen' }]);

    // A stale token is passed in deliberately: this provider must ignore it.
    const out = await provider().pullChanges(feedKey, 'a-stale-token');

    expect(out.fullResync).toBe(true);
    expect(out.nextToken).toBeNull();
    expect(out.deletions).toEqual([]);
    expect(out.upserts).toEqual([{
      externalId: 't-1', title: 'Müll rausbringen', notes: null,
      dueAt: null, completedAt: null, status: 'open',
      listId: 'list-1', listName: 'Haushalt', memberId,
    }]);
    const call = fake.calls.find((c) => c.path.endsWith('/tasks'))!;
    // Google hides completed tasks by default: without BOTH flags a completion
    // would look like a deletion to the reconciler.
    expect(call.query).toContain('showCompleted=true');
    expect(call.query).toContain('showHidden=true');
  });

  it('carries a completed task through as completed, NOT as a deletion', async () => {
    const { feedKey } = await connectedMemberWithList();
    fake.setTasks('list-1', [{
      id: 't-done', title: 'Erledigt', status: 'completed',
      completed: '2026-09-01T18:42:11.000Z', hidden: true,
    }]);

    const out = await provider().pullChanges(feedKey, null);
    expect(out.upserts).toHaveLength(1);
    expect(out.upserts[0]).toMatchObject({
      externalId: 't-done', status: 'completed',
      // A real RFC3339 instant: Google is better than To Do here, so it is
      // stored as-is rather than coarsened to a date.
      completedAt: '2026-09-01T18:42:11.000Z',
    });
    expect(out.deletions).toEqual([]);
  });

  it('converts a date-only due value to household-local midnight', async () => {
    const { feedKey } = await connectedMemberWithList();
    fake.setTasks('list-1', [{ id: 't-due', title: 'Fällig', due: '2026-09-05T00:00:00.000Z' }]);
    const [task] = (await provider().pullChanges(feedKey, null)).upserts;
    // Berlin is UTC+2 in September.
    expect(task!.dueAt).toBe('2026-09-04T22:00:00.000Z');
  });

  it('ignores a tombstoned task rather than mirroring it', async () => {
    const { feedKey } = await connectedMemberWithList();
    fake.setTasks('list-1', [
      { id: 't-live', title: 'Lebt' },
      { id: 't-dead', title: 'Weg', deleted: true },
    ]);
    const out = await provider().pullChanges(feedKey, null);
    expect(out.upserts.map((t) => t.externalId)).toEqual(['t-live']);
  });

  it('pages to exhaustion', async () => {
    const { feedKey } = await connectedMemberWithList();
    fake.tasksPageSize = 1;
    fake.setTasks('list-1', [{ id: 't-1', title: 'A' }, { id: 't-2', title: 'B' }, { id: 't-3', title: 'C' }]);
    const out = await provider().pullChanges(feedKey, null);
    expect(out.upserts.map((t) => t.externalId)).toEqual(['t-1', 't-2', 't-3']);
  });

  it('refuses a feed key with no allowlist row', async () => {
    const { memberId } = await connectedMemberWithList();
    await expect(
      provider().pullChanges(`google:todo:member:${memberId}:not-allowlisted`, null),
    ).rejects.toThrow(/Unknown Google task feed/);
  });
});

describe('GoogleTaskProvider write-back', () => {
  it('patches a completion with a real instant', async () => {
    const { feedKey } = await connectedMemberWithList();
    await provider().setCompleted(feedKey, 't-1', true);
    const call = fake.calls.find((c) => c.method === 'PATCH')!;
    expect(call.path).toBe('/tasks/v1/lists/list-1/tasks/t-1');
    expect(call.body).toMatchObject({ status: 'completed' });
    expect(typeof (call.body as { completed?: string }).completed).toBe('string');
  });

  it('clears the completion instant when re-opening a task', async () => {
    const { feedKey } = await connectedMemberWithList();
    await provider().setCompleted(feedKey, 't-1', false);
    const call = fake.calls.find((c) => c.method === 'PATCH')!;
    expect(call.body).toEqual({ status: 'needsAction', completed: null });
  });

  it('creates a task with a date-only due value', async () => {
    const { memberId, feedKey } = await connectedMemberWithList();
    const created = await provider().createTask(feedKey, {
      title: 'Neue Aufgabe', notes: 'Kontext', dueAt: '2026-09-05T22:00:00.000Z',
    });
    const call = fake.calls.find((c) => c.method === 'POST')!;
    // 2026-09-05T22:00Z is 2026-09-06 local in Berlin — the intended day.
    expect(call.body).toMatchObject({ title: 'Neue Aufgabe', notes: 'Kontext', due: '2026-09-06T00:00:00.000Z' });
    expect(created).toMatchObject({ title: 'Neue Aufgabe', memberId, listId: 'list-1', status: 'open' });
  });

  it('wraps a write failure in a classified TaskProviderError', async () => {
    const { feedKey } = await connectedMemberWithList();
    fake.failRefresh = true;
    rt.oauth.clearCache();
    const e = await provider().setCompleted(feedKey, 't-1', true).catch((err: unknown) => err);
    expect(e).toBeInstanceOf(TaskProviderError);
    expect((e as TaskProviderError).reason).toBe('needs_reauth');
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run tests/google-tasks-sync.test.ts`
Expected: FAIL — cannot resolve `../src/google/task-provider.js`.

- [ ] **Step 5: Write the implementation**

Create `src/google/task-provider.ts`:

```ts
import type { GoogleRuntime } from './runtime.js';
import { GOOGLE_TASKS_BASE } from './api.js';
import { classify } from './sync-runner.js';
import { localDateOf, zonedMidnightUtc } from '../lib/local-date.js';
import { getHouseholdTimeZone } from '../household/timezone.js';
import { getTaskFeedByKey } from '../modules/tasks/store.js';
import {
  TaskProviderError,
  type AvailableList, type CreateTaskInput, type MirroredTask,
  type TaskProvider, type TaskPullResult,
} from '../modules/tasks/providers/types.js';

/**
 * The Google Tasks provider — SNAPSHOT-BASED, deliberately.
 *
 * Google Tasks has no delta API. Imitating one with `updatedMin` +
 * `showDeleted` was the original design and it was wrong: deletions surface
 * only while Google retains the tombstone, so past retention a task deleted on
 * a phone stays mirrored forever.
 *
 * So every pull fetches the COMPLETE list and reports `fullResync: true`, and
 * `applyTaskPull` reconciles: everything present is upserted, everything absent
 * is deleted. A deletion is detected structurally, with no tombstone required.
 * Lists are small (tens of items, pages of 100), so a full pull is 1-2 calls per
 * feed — far below the default project quota even at a 5-minute tick.
 *
 * Consequences worth stating: `syncToken` is ignored entirely, there is no
 * 410-equivalent recovery path, and `lastFullSyncAt` is stamped every tick,
 * which is simply true for this provider.
 */

const MAX_PAGES = 50;
const PAGE_SIZE = 100;

interface GoogleTask {
  id: string;
  title?: string | null;
  notes?: string | null;
  /** RFC3339, but date-only in effect: Google stores UTC midnight. */
  due?: string | null;
  status?: string; // needsAction | completed
  /** RFC3339 — a REAL instant, unlike To Do's date-only completion stamp. */
  completed?: string | null;
  deleted?: boolean;
  hidden?: boolean;
}

interface TasksListResponse {
  items?: GoogleTask[];
  nextPageToken?: string;
}

interface TaskListsResponse {
  items?: Array<{ id: string; title?: string | null }>;
  nextPageToken?: string;
}

export class GoogleTaskProvider implements TaskProvider {
  readonly source = 'google';

  constructor(
    private readonly rt: GoogleRuntime,
    private readonly resolveTimeZone: () => Promise<string> = getHouseholdTimeZone,
  ) {}

  async listAvailableLists(memberId: string): Promise<AvailableList[]> {
    try {
      const token = await this.rt.oauth.getAccessToken(memberId);
      const out: AvailableList[] = [];
      let url = `${GOOGLE_TASKS_BASE}/users/@me/lists?maxResults=${PAGE_SIZE}`;
      for (let page = 0; page < MAX_PAGES; page++) {
        const res = await this.rt.googleFetch<TaskListsResponse>(token, url);
        for (const l of res.items ?? []) {
          out.push({ id: l.id, name: l.title?.trim() || '(untitled list)' });
        }
        if (!res.nextPageToken) break;
        url = `${GOOGLE_TASKS_BASE}/users/@me/lists?maxResults=${PAGE_SIZE}&pageToken=${encodeURIComponent(res.nextPageToken)}`;
      }
      return out;
    } catch (e) {
      throw new TaskProviderError(classify(e));
    }
  }

  /**
   * Pull the WHOLE list. `syncToken` and `forceFullResync` are both ignored —
   * every pull is already a full pull. Throws the raw error so the sync runner
   * classifies it (the write paths below wrap instead).
   */
  async pullChanges(feedKey: string, _syncToken: string | null): Promise<TaskPullResult> {
    const feed = await this.requireFeed(feedKey);
    const zone = await this.resolveTimeZone();
    const token = await this.rt.oauth.getAccessToken(feed.memberId);

    const upserts: MirroredTask[] = [];
    // BOTH flags are required: Google omits completed tasks by default and
    // marks them hidden, so without them a completion reads as a deletion.
    const base = `${GOOGLE_TASKS_BASE}/lists/${encodeURIComponent(feed.listId)}/tasks`
      + `?showCompleted=true&showHidden=true&maxResults=${PAGE_SIZE}`;
    let url = base;

    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await this.rt.googleFetch<TasksListResponse>(token, url);
      for (const t of res.items ?? []) {
        // A tombstone still in Google's retention window. The reconcile already
        // removes it by absence; mirroring it would resurrect a deleted task.
        if (t.deleted) continue;
        upserts.push(this.toMirrored(t, feed.memberId, feed.listId, feed.listName, zone));
      }
      if (!res.nextPageToken) break;
      url = `${base}&pageToken=${encodeURIComponent(res.nextPageToken)}`;
    }

    // `deletions` stays empty and `fullResync` is always true: the snapshot IS
    // the feed, and the store reconciles against it.
    return { upserts, deletions: [], nextToken: null, fullResync: true };
  }

  async setCompleted(feedKey: string, externalId: string, completed: boolean): Promise<void> {
    try {
      const feed = await this.requireFeed(feedKey);
      const token = await this.rt.oauth.getAccessToken(feed.memberId);
      // Google Tasks takes a real instant here, so no date coarsening is needed
      // and none should be applied.
      const body = completed
        ? { status: 'completed', completed: new Date().toISOString() }
        : { status: 'needsAction', completed: null };
      await this.rt.googleFetch<GoogleTask>(
        token,
        `${GOOGLE_TASKS_BASE}/lists/${encodeURIComponent(feed.listId)}/tasks/${encodeURIComponent(externalId)}`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      );
    } catch (e) {
      throw new TaskProviderError(classify(e));
    }
  }

  async createTask(feedKey: string, input: CreateTaskInput): Promise<MirroredTask> {
    try {
      const feed = await this.requireFeed(feedKey);
      const zone = await this.resolveTimeZone();
      const token = await this.rt.oauth.getAccessToken(feed.memberId);
      const body: Record<string, unknown> = { title: input.title };
      if (input.notes) body['notes'] = input.notes;
      if (input.dueAt) {
        // `due` is date-only in effect: Google keeps the date part and drops the
        // time. Send UTC midnight of the HOUSEHOLD-local date so the intended
        // day survives the truncation.
        body['due'] = `${localDateOf(input.dueAt, zone)}T00:00:00.000Z`;
      }
      const created = await this.rt.googleFetch<GoogleTask>(
        token,
        `${GOOGLE_TASKS_BASE}/lists/${encodeURIComponent(feed.listId)}/tasks`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      );
      return this.toMirrored(created, feed.memberId, feed.listId, feed.listName, zone);
    } catch (e) {
      throw new TaskProviderError(classify(e));
    }
  }

  /**
   * Resolve the feed from its allowlist row. NEVER parses the key: a Google
   * list id is opaque and the row carries the cached list name anyway.
   */
  private async requireFeed(feedKey: string) {
    const feed = await getTaskFeedByKey(feedKey);
    if (!feed) throw new Error(`Unknown Google task feed: ${feedKey}`);
    return feed;
  }

  private toMirrored(
    t: GoogleTask, memberId: string, listId: string, listName: string | null, zone: string,
  ): MirroredTask {
    const completed = t.status === 'completed';
    return {
      externalId: t.id,
      title: t.title?.trim() || '(untitled)',
      notes: t.notes?.trim() || null,
      dueAt: this.toLocalMidnightIso(t.due, zone),
      // A real instant — kept exactly, no coarsening. The fallback covers a
      // completed task Google returned without a stamp.
      completedAt: completed ? (t.completed ? new Date(t.completed).toISOString() : new Date().toISOString()) : null,
      status: completed ? 'completed' : 'open',
      listId,
      listName,
      memberId,
    };
  }

  /**
   * `due` is a CALENDAR DATE wearing an instant's clothes: Google stores UTC
   * midnight and ignores the time part. Take the date part verbatim and anchor
   * it to household-local midnight, so local-day bucketing lands on the
   * intended day.
   */
  private toLocalMidnightIso(due: string | null | undefined, zone: string): string | null {
    if (!due) return null;
    return zonedMidnightUtc(due.slice(0, 10), zone).toISOString();
  }
}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/google-tasks-sync.test.ts && npm run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 7: Prove the showHidden trap is covered**

Temporarily drop `showHidden=true` from the query, re-run, and confirm "carries a completed task through as completed, NOT as a deletion" fails. Restore it.

- [ ] **Step 8: Commit**

```bash
git add src/google/task-provider.ts src/modules/tasks/store.ts tests/fake-google.ts tests/google-tasks-sync.test.ts
git commit -m "feat(google): add the snapshot-based Google Tasks provider"
```

---

### Task 10: Google task sync runner

**Files:**
- Create: `src/google/task-sync.ts`
- Test: `tests/google-tasks-sync.test.ts` (append a `describe` block)

**Interfaces:**
- Consumes: `GoogleTaskProvider` (Task 9), `classify` / `googleFullResyncIntervalMs` (Task 3), `syncOneFeed` (`src/integrations/sync-runner.js`), `listAllowlistedFeeds` / `applyTaskPull` (`src/modules/tasks/store.js`).
- Produces: `runGoogleTaskSync(rt?: GoogleRuntime, provider?: TaskProvider): Promise<FeedSyncResult[]>`.

- [ ] **Step 1: Write the failing test**

Append to `tests/google-tasks-sync.test.ts`:

```ts
import { eq } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { taskMirror } from '../src/modules/tasks/schema.js';
import { runGoogleTaskSync } from '../src/google/task-sync.js';

describe('runGoogleTaskSync', () => {
  it('mirrors the snapshot and records per-feed success', async () => {
    const { feedKey } = await connectedMemberWithList();
    fake.setTasks('list-1', [{ id: 't-1', title: 'Müll rausbringen' }]);

    const results = await runGoogleTaskSync(rt, provider());
    expect(results).toEqual([{ feedKey, status: 'ok', upserted: 1, deleted: 0 }]);

    const rows = await db.select().from(taskMirror).where(eq(taskMirror.source, 'google'));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.listName).toBe('Haushalt');
  });

  it('DELETES a task that vanished at the source, with no tombstone', async () => {
    await connectedMemberWithList();
    fake.setTasks('list-1', [{ id: 't-1', title: 'Bleibt' }, { id: 't-2', title: 'Verschwindet' }]);
    await runGoogleTaskSync(rt, provider());
    const before = await db.select().from(taskMirror).where(eq(taskMirror.externalId, 't-1'));

    // The next snapshot simply does not contain t-2 — no tombstone anywhere.
    fake.setTasks('list-1', [{ id: 't-1', title: 'Bleibt' }]);
    const [result] = await runGoogleTaskSync(rt, provider());

    expect(result).toMatchObject({ status: 'ok', upserted: 1, deleted: 1 });
    const after = await db.select().from(taskMirror).where(eq(taskMirror.source, 'google'));
    expect(after.map((r) => r.externalId)).toEqual(['t-1']);
    // The surviving row keeps its uuid: GET /api/v1/tasks hands these ids to the
    // web, and churning them every tick would make /:id/complete flakily 404.
    expect(after[0]!.id).toBe(before[0]!.id);
  });

  it('does not touch an M365 feed', async () => {
    const { adult } = await seedTestHousehold();
    await rt.store.upsertConnection({
      memberId: adult.user.id, accountLabel: 'a@gmail.test', refreshToken: 'r', scopes: '',
    });
    await setAllowlist(adult.user.id, 'm365', [{ id: 'm365-list', name: 'Outlook' }]);
    const results = await runGoogleTaskSync(rt, provider());
    expect(results).toEqual([]);
  });

  it('classifies an upstream failure as google_<status>', async () => {
    const { feedKey } = await connectedMemberWithList();
    fake.failTasks.add('list-1');
    const [result] = await runGoogleTaskSync(rt, provider());
    expect(result).toMatchObject({ feedKey, status: 'error', reason: 'google_500' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/google-tasks-sync.test.ts`
Expected: FAIL — cannot resolve `../src/google/task-sync.js`.

- [ ] **Step 3: Write the implementation**

Create `src/google/task-sync.ts`:

```ts
import { getGoogleRuntime, type GoogleRuntime } from './runtime.js';
import { GoogleTaskProvider } from './task-provider.js';
import { classify, googleFullResyncIntervalMs } from './sync-runner.js';
import { syncOneFeed, type FeedSyncResult } from '../integrations/sync-runner.js';
import { listAllowlistedFeeds, applyTaskPull } from '../modules/tasks/store.js';
import type { TaskProvider } from '../modules/tasks/providers/types.js';

/**
 * Google Tasks sync runner — the sibling of `src/m365/task-sync.ts`. Feeds come
 * from the per-member list allowlist SCOPED TO 'google', so an M365 list is
 * never pulled through this runner.
 *
 * The provider reports `fullResync: true` on every pull, so `applyTaskPull`
 * reconciles every tick. That is the point of the design, not an accident.
 */
export async function runGoogleTaskSync(
  rt: GoogleRuntime = getGoogleRuntime(),
  provider: TaskProvider = new GoogleTaskProvider(rt),
): Promise<FeedSyncResult[]> {
  const feeds = await listAllowlistedFeeds('google');
  const results: FeedSyncResult[] = [];
  for (const feed of feeds) {
    results.push(await syncOneFeed(
      { store: rt.store, classifyError: classify, fullResyncIntervalMs: googleFullResyncIntervalMs() },
      feed,
      async (syncToken, forceFullResync) => {
        const result = await provider.pullChanges(feed.feedKey, syncToken, forceFullResync);
        const { upserted, deleted } = await applyTaskPull(provider.source, feed, result);
        return { nextToken: result.nextToken, fullResync: result.fullResync, upserted, deleted };
      },
    ));
  }
  return results;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/google-tasks-sync.test.ts tests/m365-tasks-sync.test.ts && npm run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/google/task-sync.ts tests/google-tasks-sync.test.ts
git commit -m "feat(google): add the Google task sync runner"
```

---

### Task 11: Register the Google module

**Files:**
- Create: `src/google/index.ts`
- Modify: `src/modules/index.ts`
- Test: `tests/google-routes.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–10; `registerProvider` / `RegisteredProvider` (`src/integrations/registry.js`).
- Produces: `googleModule: HeorthModule` (name `'google'`), plus the module's public re-exports (`getGoogleRuntime`, `setGoogleRuntime`, `createGoogleRuntime`, `isGoogleEnabled`, `GoogleRuntime`, `runGoogleCalendarSync`, `runGoogleTaskSync`, `GoogleCalendarProvider`, `GoogleTaskProvider`, `GoogleApiError`, `GOOGLE_SCOPES`).

- [ ] **Step 1: Write the failing test**

Create `tests/google-routes.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { seedTestHousehold, authHeaders } from './helpers.js';
import { app } from '../src/app.js';
import { clearProviders, listProviders, registerProvider } from '../src/integrations/registry.js';
import { IntegrationStore } from '../src/integrations/store.js';
import { createFakeGoogle, runtimeForFakeGoogle, type FakeGoogle } from './fake-google.js';
import { GoogleCalendarProvider } from '../src/google/calendar-provider.js';
import { GoogleTaskProvider } from '../src/google/task-provider.js';
import { classify, googleFullResyncIntervalMs } from '../src/google/sync-runner.js';
import { runGoogleCalendarSync } from '../src/google/calendar-sync.js';
import { runGoogleTaskSync } from '../src/google/task-sync.js';
import type { GoogleRuntime } from '../src/google/runtime.js';

let fake: FakeGoogle;
let rt: GoogleRuntime;

/**
 * Register Google the way `googleModule.register()` does, but from an injected
 * fake-backed runtime — the module itself is a no-op under the suite because
 * `tests/setup.ts` blanks the GOOGLE_* group.
 */
function registerGoogleWithFake(runtime: GoogleRuntime): void {
  registerProvider({
    id: 'google',
    store: runtime.store,
    classifyError: classify,
    fullResyncIntervalMs: googleFullResyncIntervalMs(),
    authorizeUrl: (state) => runtime.oauth.authorizeUrl(state),
    completeConnect: async (code) => {
      const { refreshToken, accessToken, scopes } = await runtime.oauth.exchangeCode(code);
      return { accountLabel: await runtime.oauth.getUserEmail(accessToken), refreshToken, scopes };
    },
    calendar: new GoogleCalendarProvider(runtime),
    tasks: new GoogleTaskProvider(runtime),
    runCalendarSync: () => runGoogleCalendarSync(runtime),
    runTaskSync: () => runGoogleTaskSync(runtime),
  });
}

beforeEach(() => {
  clearProviders();
  fake = createFakeGoogle();
  rt = runtimeForFakeGoogle(fake);
});
afterEach(() => { clearProviders(); });

describe('the google module', () => {
  it('registers no provider when the GOOGLE_* group is absent', async () => {
    const { googleModule } = await import('../src/google/index.js');
    googleModule.register(app);
    expect(listProviders()).toEqual([]);
  });
});

describe('/api/v1/integrations/google', () => {
  it('404s the connect route when Google is not registered', async () => {
    const { adult } = await seedTestHousehold();
    const res = await app.request('/api/v1/integrations/google/connect-url', { headers: authHeaders(adult.jwt) });
    expect(res.status).toBe(404);
  });

  it('returns a consent URL carrying offline access when registered', async () => {
    const { adult } = await seedTestHousehold();
    registerGoogleWithFake(rt);
    const res = await app.request('/api/v1/integrations/google/connect-url', { headers: authHeaders(adult.jwt) });
    expect(res.status).toBe(200);
    const { data } = await res.json() as { data: { url: string } };
    const url = new URL(data.url);
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
  });

  it('stores a connection labelled with the Google account email on callback', async () => {
    const { adult } = await seedTestHousehold();
    registerGoogleWithFake(rt);
    fake.userEmail = 'anna@gmail.test';

    const urlRes = await app.request('/api/v1/integrations/google/connect-url', { headers: authHeaders(adult.jwt) });
    const state = new URL((await urlRes.json() as { data: { url: string } }).data.url).searchParams.get('state')!;

    const cb = await app.request(`/api/v1/integrations/google/callback?code=abc&state=${encodeURIComponent(state)}`);
    expect(cb.status).toBe(302);
    expect(cb.headers.get('location')).toBe('/profile?connected=google');
    expect((await rt.store.getConnection(adult.user.id))!.accountLabel).toBe('anna@gmail.test');
  });

  it('refuses to store a connection when Google issued no refresh token', async () => {
    const { adult } = await seedTestHousehold();
    registerGoogleWithFake(rt);
    fake.omitRefreshToken = true;

    const urlRes = await app.request('/api/v1/integrations/google/connect-url', { headers: authHeaders(adult.jwt) });
    const state = new URL((await urlRes.json() as { data: { url: string } }).data.url).searchParams.get('state')!;

    const cb = await app.request(`/api/v1/integrations/google/callback?code=abc&state=${encodeURIComponent(state)}`);
    expect(cb.status).toBe(302);
    expect(cb.headers.get('location')).toBe('/profile?connectError=GOOGLE_EXCHANGE_FAILED');
    expect(await rt.store.getConnection(adult.user.id)).toBeNull();
  });

  it('lists google among the providers on /status', async () => {
    const { adult } = await seedTestHousehold();
    registerGoogleWithFake(rt);
    const res = await app.request('/api/v1/integrations/status', { headers: authHeaders(adult.jwt) });
    const { data } = await res.json() as { data: { providers: string[] } };
    expect(data.providers).toContain('google');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/google-routes.test.ts`
Expected: FAIL — cannot resolve `../src/google/index.js`.

- [ ] **Step 3: Write the module**

Create `src/google/index.ts`:

```ts
import type { HeorthModule } from '../modules/registry.js';
import { getGoogleRuntime, isGoogleEnabled } from './runtime.js';
import { GoogleCalendarProvider } from './calendar-provider.js';
import { GoogleTaskProvider } from './task-provider.js';
import { registerProvider } from '../integrations/registry.js';
import { runGoogleCalendarSync } from './calendar-sync.js';
import { runGoogleTaskSync } from './task-sync.js';
import { classify, googleFullResyncIntervalMs } from './sync-runner.js';

/**
 * The Google area registers as a module but is a NO-OP when the integration is
 * disabled (no `GOOGLE_*` env) — the same contract as `src/m365/index.ts`. When
 * enabled it registers itself into the integrations registry; it mounts no
 * routes of its own, because `/api/v1/integrations/:provider/*` already hosts
 * them for every provider.
 */
export const googleModule: HeorthModule = {
  name: 'google',
  register(): void {
    if (!isGoogleEnabled()) return;
    const rt = getGoogleRuntime();
    registerProvider({
      id: 'google',
      store: rt.store,
      classifyError: classify,
      fullResyncIntervalMs: googleFullResyncIntervalMs(),
      authorizeUrl: (state) => rt.oauth.authorizeUrl(state),
      completeConnect: async (code) => {
        // Throws GoogleNoRefreshTokenError when Google issued none — the
        // callback turns that into GOOGLE_EXCHANGE_FAILED and stores nothing,
        // rather than persisting a connection that dies within the hour.
        const { refreshToken, accessToken, scopes } = await rt.oauth.exchangeCode(code);
        const accountLabel = await rt.oauth.getUserEmail(accessToken);
        return { accountLabel, refreshToken, scopes };
      },
      calendar: new GoogleCalendarProvider(rt),
      tasks: new GoogleTaskProvider(rt),
      runCalendarSync: () => runGoogleCalendarSync(rt),
      runTaskSync: () => runGoogleTaskSync(rt),
    });
  },
};

export {
  getGoogleRuntime, setGoogleRuntime, createGoogleRuntime, isGoogleEnabled, type GoogleRuntime,
} from './runtime.js';
export { runGoogleCalendarSync } from './calendar-sync.js';
export { runGoogleTaskSync } from './task-sync.js';
export { GoogleCalendarProvider } from './calendar-provider.js';
export { GoogleTaskProvider } from './task-provider.js';
export { GoogleApiError } from './api.js';
export { GOOGLE_SCOPES, GoogleNoRefreshTokenError } from './oauth.js';
```

- [ ] **Step 4: Add it to `ALL_MODULES`**

In `src/modules/index.ts`, import `googleModule` and place it immediately after `m365Module` — BEFORE `integrationsModule`, whose comment already states why provider modules must come first:

```ts
  // M365 is a no-op when its env is absent (integration disabled) — see src/m365.
  m365Module,
  // Google is a no-op when its env is absent — see src/google.
  googleModule,
  // Integrations hosts the routes for every provider; providers register from
  // their own module, so this MUST come after them in this list.
  integrationsModule,
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/google-routes.test.ts tests/integrations-routes.test.ts tests/module-convention.test.ts && npm run typecheck`
Expected: PASS, typecheck clean. `module-convention.test.ts` is what catches a module that does not follow the registration convention.

- [ ] **Step 6: Commit**

```bash
git add src/google/index.ts src/modules/index.ts tests/google-routes.test.ts
git commit -m "feat(google): register Google as a second integration provider"
```

---

### Task 12: Make the task allowlist API provider-aware

Phase 1 left this half-migrated, deliberately and unreachably: `service.listAvailableLists` iterates every provider and tags each entry, but `getAllowlist` / `setAllowlist` hardcode `DEFAULT_PROVIDER = 'm365'`. With Google registered, **its lists appear in the picker but can never be enabled** — `setAllowlist` would persist them under `provider = 'm365'`, or reject them. The store layer is already correct; the gap is the service and the route above it.

**Files:**
- Modify: `src/modules/tasks/service.ts:25` (drop `DEFAULT_PROVIDER`), `:74-96` (both functions), `src/modules/tasks/validators.ts:22-24`, `src/modules/tasks/routes.ts:62-75`, `src/modules/tasks/store.ts:190-194` (`provider` optional)
- Test: `tests/tasks-allowlist-provider.test.ts`

**Interfaces:**
- Consumes: `listProviders`, `store.getAllowlist` / `store.setAllowlist`, `TaskProviderError`.
- Produces:
  - `store.getAllowlist(memberId: string, provider?: string): Promise<TodoListAllowlistRow[]>` — provider now OPTIONAL (all providers when omitted).
  - `service.getAllowlist(memberId: string): Promise<TodoListAllowlistRow[]>` — every provider's rows.
  - `service.setAllowlist(memberId: string, entries: Array<{ provider: string; listId: string }>): Promise<TodoListAllowlistRow[]>`.
  - `setAllowlistSchema` = `z.object({ lists: z.array(z.object({ provider: z.string().min(1), listId: z.string().min(1) })).default([]) })`.

- [ ] **Step 1: Write the failing test**

Create `tests/tasks-allowlist-provider.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { seedTestHousehold, authHeaders, registerFakeTaskProvider } from './helpers.js';
import { app } from '../src/app.js';
import { clearProviders } from '../src/integrations/registry.js';
import { TaskProviderError } from '../src/modules/tasks/providers/types.js';
import type { AvailableList, TaskProvider } from '../src/modules/tasks/providers/types.js';

function fakeTaskProvider(id: string, lists: AvailableList[], failWith?: string): TaskProvider {
  return {
    source: id,
    listAvailableLists: async () => {
      if (failWith) throw new TaskProviderError(failWith);
      return lists;
    },
    pullChanges: async () => ({ upserts: [], deletions: [], nextToken: null, fullResync: true }),
    setCompleted: async () => {},
    createTask: async () => { throw new TaskProviderError('error'); },
  };
}

beforeEach(() => { clearProviders(); });
afterEach(() => { clearProviders(); });

describe('PUT /api/v1/tasks/allowlist', () => {
  it('enables a GOOGLE list under the google provider, not m365', async () => {
    const { adult } = await seedTestHousehold();
    registerFakeTaskProvider('m365', fakeTaskProvider('m365', [{ id: 'outlook-1', name: 'Outlook' }]));
    registerFakeTaskProvider('google', fakeTaskProvider('google', [{ id: 'g-1', name: 'Haushalt' }]));

    const put = await app.request('/api/v1/tasks/allowlist', {
      method: 'PUT', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ lists: [{ provider: 'google', listId: 'g-1' }] }),
    });
    expect(put.status).toBe(200);

    const res = await app.request('/api/v1/tasks/allowlist', { headers: authHeaders(adult.jwt) });
    const { data } = await res.json() as { data: Array<{ provider: string; listId: string }> };
    expect(data).toEqual([expect.objectContaining({ provider: 'google', listId: 'g-1' })]);
  });

  it('returns every provider\'s rows from GET, not just m365\'s', async () => {
    const { adult } = await seedTestHousehold();
    registerFakeTaskProvider('m365', fakeTaskProvider('m365', [{ id: 'outlook-1', name: 'Outlook' }]));
    registerFakeTaskProvider('google', fakeTaskProvider('google', [{ id: 'g-1', name: 'Haushalt' }]));

    await app.request('/api/v1/tasks/allowlist', {
      method: 'PUT', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ lists: [
        { provider: 'm365', listId: 'outlook-1' },
        { provider: 'google', listId: 'g-1' },
      ] }),
    });

    const res = await app.request('/api/v1/tasks/allowlist', { headers: authHeaders(adult.jwt) });
    const { data } = await res.json() as { data: Array<{ provider: string }> };
    expect(data.map((r) => r.provider).sort()).toEqual(['google', 'm365']);
  });

  it('de-selecting every list of one provider leaves the other provider alone', async () => {
    const { adult } = await seedTestHousehold();
    registerFakeTaskProvider('m365', fakeTaskProvider('m365', [{ id: 'outlook-1', name: 'Outlook' }]));
    registerFakeTaskProvider('google', fakeTaskProvider('google', [{ id: 'g-1', name: 'Haushalt' }]));
    await app.request('/api/v1/tasks/allowlist', {
      method: 'PUT', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ lists: [
        { provider: 'm365', listId: 'outlook-1' },
        { provider: 'google', listId: 'g-1' },
      ] }),
    });

    await app.request('/api/v1/tasks/allowlist', {
      method: 'PUT', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ lists: [{ provider: 'm365', listId: 'outlook-1' }] }),
    });

    const res = await app.request('/api/v1/tasks/allowlist', { headers: authHeaders(adult.jwt) });
    const { data } = await res.json() as { data: Array<{ provider: string }> };
    expect(data.map((r) => r.provider)).toEqual(['m365']);
  });

  it('leaves an unreachable provider\'s rows untouched instead of wiping them', async () => {
    const { adult } = await seedTestHousehold();
    registerFakeTaskProvider('google', fakeTaskProvider('google', [{ id: 'g-1', name: 'Haushalt' }]));
    await app.request('/api/v1/tasks/allowlist', {
      method: 'PUT', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ lists: [{ provider: 'google', listId: 'g-1' }] }),
    });

    // Google goes unreachable; the picker could not show its lists, so the next
    // submission carries none for it. That must NOT be read as a de-selection.
    clearProviders();
    registerFakeTaskProvider('google', fakeTaskProvider('google', [], 'no_connection'));
    registerFakeTaskProvider('m365', fakeTaskProvider('m365', [{ id: 'outlook-1', name: 'Outlook' }]));
    await app.request('/api/v1/tasks/allowlist', {
      method: 'PUT', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ lists: [{ provider: 'm365', listId: 'outlook-1' }] }),
    });

    const res = await app.request('/api/v1/tasks/allowlist', { headers: authHeaders(adult.jwt) });
    const { data } = await res.json() as { data: Array<{ provider: string }> };
    expect(data.map((r) => r.provider).sort()).toEqual(['google', 'm365']);
  });

  it('rejects a list the member cannot access', async () => {
    const { adult } = await seedTestHousehold();
    registerFakeTaskProvider('google', fakeTaskProvider('google', [{ id: 'g-1', name: 'Haushalt' }]));
    const res = await app.request('/api/v1/tasks/allowlist', {
      method: 'PUT', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ lists: [{ provider: 'google', listId: 'not-mine' }] }),
    });
    expect(res.status).toBe(409);
    expect((await res.json() as { error: { code: string } }).error.code).toBe('UNKNOWN_LIST');
  });

  it('rejects a body still using the old listIds shape', async () => {
    const { adult } = await seedTestHousehold();
    const res = await app.request('/api/v1/tasks/allowlist', {
      method: 'PUT', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ listIds: ['g-1'] }),
    });
    // `lists` defaults to [] and `listIds` is stripped, so this is a no-op 200
    // rather than a silent m365 write — assert whichever the schema produces,
    // but it must NOT persist anything.
    const check = await app.request('/api/v1/tasks/allowlist', { headers: authHeaders(adult.jwt) });
    expect((await check.json() as { data: unknown[] }).data).toEqual([]);
    expect([200, 400]).toContain(res.status);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tasks-allowlist-provider.test.ts`
Expected: FAIL — the google list is rejected or persisted under `m365`.

- [ ] **Step 3: Make the store's provider argument optional**

In `src/modules/tasks/store.ts`, replace `getAllowlist`:

```ts
/**
 * A member's allowlisted lists. `provider` narrows to one provider; omitted, it
 * returns every provider's rows — which is what the picker and the settings
 * surface need now that a member may hold lists at both.
 */
export async function getAllowlist(memberId: string, provider?: string): Promise<TodoListAllowlistRow[]> {
  const where = provider
    ? and(eq(todoListAllowlist.memberId, memberId), eq(todoListAllowlist.provider, provider))
    : eq(todoListAllowlist.memberId, memberId);
  return db.select().from(todoListAllowlist).where(where).orderBy(asc(todoListAllowlist.listName));
}
```

- [ ] **Step 4: Rewrite the service functions**

In `src/modules/tasks/service.ts`, delete the `DEFAULT_PROVIDER` constant (and the paragraph of the file docblock that describes it), then replace `getAllowlist` and `setAllowlist`:

```ts
/** Every allowlisted list the member holds, across all providers. */
export async function getAllowlist(memberId: string): Promise<TodoListAllowlistRow[]> {
  return store.getAllowlist(memberId);
}

/**
 * Replace a member's allowlist across providers.
 *
 * The submitted ids are validated against the member's LIVE lists per provider,
 * so the cached display names are right and an inaccessible id is refused.
 *
 * Replacement is scoped to the providers whose discovery SUCCEEDED: a provider
 * that is unreachable right now could not have shown its lists in the picker,
 * so an absent entry for it means "not offered", not "de-selected". Wiping it
 * would silently stop syncing lists the member never touched.
 */
export async function setAllowlist(
  memberId: string, entries: Array<{ provider: string; listId: string }>,
): Promise<TodoListAllowlistRow[]> {
  await assertNotMaintenanceAdmin(memberId);
  for (const p of listProviders()) {
    if (!p.tasks) continue;
    let available;
    try {
      available = await p.tasks.listAvailableLists(memberId);
    } catch (e) {
      const reason = e instanceof TaskProviderError ? e.reason : p.classifyError(e);
      if (reason === 'no_connection') continue; // not connected: leave its rows alone
      throw e;
    }
    const byId = new Map(available.map((l) => [l.id, l.name]));
    const selected: Array<{ id: string; name: string | null }> = [];
    for (const entry of entries.filter((e) => e.provider === p.id)) {
      if (!byId.has(entry.listId)) {
        throw new TaskProviderError('unknown_list', `List not accessible for this member: ${entry.listId}`);
      }
      selected.push({ id: entry.listId, name: byId.get(entry.listId) ?? null });
    }
    await store.setAllowlist(memberId, p.id, selected);
  }
  return store.getAllowlist(memberId);
}
```

Note `requireProviderFor` may now be unused in this file — remove the import if the compiler says so, but keep the export in `provider.ts` (the write paths still use it).

- [ ] **Step 5: Update the validator and the route**

In `src/modules/tasks/validators.ts`, replace `setAllowlistSchema`:

```ts
/**
 * Provider-aware allowlist submission. The old `{ listIds: string[] }` shape
 * could not express which provider a list belonged to, so a Google list was
 * unselectable. No alias is kept — the web is the only client, and heorth-mcp
 * does not touch this route.
 */
export const setAllowlistSchema = z.object({
  lists: z.array(z.object({
    provider: z.string().min(1),
    listId: z.string().min(1),
  })).default([]),
});
```

In `src/modules/tasks/routes.ts`, the PUT handler becomes:

```ts
tasksRouter.put('/allowlist', async (c) => {
  const body = setAllowlistSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  try {
    return ok(c, await service.setAllowlist(c.get('auth').userId, body.data.lists));
  } catch (e) {
    return writeError(c, e);
  }
});
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/tasks-allowlist-provider.test.ts tests/tasks-provider-routing.test.ts tests/tasks-household-list.test.ts tests/tasks-household-list-routes.test.ts tests/m365-tasks-sync.test.ts && npm run typecheck`
Expected: PASS, typecheck clean. Existing suites that submit the old body shape must be updated to `{ lists: [...] }` — that is a fixture change, not an assertion change.

- [ ] **Step 7: Commit**

```bash
git add src/modules/tasks tests/tasks-allowlist-provider.test.ts
git commit -m "feat(tasks): make the list allowlist API provider-aware"
```

---

### Task 13: Multi-provider maintenance-admin cleanup

`stripAdminOwnedData` hardcodes `'m365'` when building the stale feed keys it deletes (`src/household/maintenance-admin.ts:167-169`). Its own comment says why that matters: without it, *"a feed the admin had connected leaves a permanently frozen row in `/status`'s `feeds[]` forever."* Once Google exists, exactly that happens to the admin's Google feeds. It also never touches `calendar_allowlist`.

**Files:**
- Modify: `src/household/maintenance-admin.ts:148-185`
- Test: `tests/maintenance-admin-repair.test.ts` (append)

**Interfaces:**
- Consumes: `listProviders` (`src/integrations/registry.js`), `calendarAllowlist` (Task 5), `feedKeys`.
- Produces: no new exports; `counts` gains `calendar_allowlist`.

- [ ] **Step 1: Write the failing test**

Append to `tests/maintenance-admin-repair.test.ts` (reuse whatever this suite already imports for seeding the maintenance admin and running the repair; register a fake provider with `registerFakeTaskProvider('google', …)` from `./helpers.js`):

```ts
it('clears the admin\'s stale feed state for EVERY registered provider', async () => {
  const adminId = await seedMaintenanceAdmin();       // existing helper in this suite
  registerFakeTaskProvider('m365', stubTaskProvider());
  registerFakeTaskProvider('google', stubTaskProvider());

  await setAllowlist(adminId, 'm365', [{ id: 'outlook-1', name: 'Outlook' }]);
  await setAllowlist(adminId, 'google', [{ id: 'g-1', name: 'Haushalt' }]);
  await setCalendarAllowlist(adminId, 'google', [{ id: 'cal-a', name: 'Anna' }]);

  for (const feedKey of [
    `m365:calendar:member:${adminId}`,
    `m365:todo:member:${adminId}:outlook-1`,
    `google:calendar:member:${adminId}`,
    `google:todo:member:${adminId}:g-1`,
    `google:calendar:member:${adminId}:cal-a`,
  ]) {
    await db.insert(integrationSyncState).values({ feedKey, lastSuccessAt: new Date() });
  }

  await repairMaintenanceAdmin();                     // existing helper in this suite

  const left = await db.select().from(integrationSyncState);
  expect(left).toEqual([]);
  expect(await db.select().from(calendarAllowlist)).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/maintenance-admin-repair.test.ts`
Expected: FAIL — the three `google:*` rows and the `calendar_allowlist` row survive.

- [ ] **Step 3: Write the implementation**

In `src/household/maintenance-admin.ts`, replace the stale-feed-key block inside `stripAdminOwnedData`:

```ts
  // `integration_sync_state` is keyed by a generic `feedKey` string, not
  // `memberId`, so it cannot be targeted with a plain where(eq(memberId, …))
  // delete — the keys must be rebuilt via `feedKeys` (never hand-formatted, per
  // its own contract) BEFORE the allowlist rows they derive from are deleted.
  // Without this, a feed the admin had connected leaves a permanently frozen
  // row in `/integrations/status`'s `feeds[]` forever.
  //
  // Built for EVERY REGISTERED PROVIDER, not just m365: the single-provider
  // version of this left exactly that frozen row behind for the second one.
  const adminTodoRows = await tx.select().from(todoListAllowlist)
    .where(eq(todoListAllowlist.memberId, adminId));
  const adminCalendarRows = await tx.select().from(calendarAllowlist)
    .where(eq(calendarAllowlist.memberId, adminId));
  const providerIds = listProviders().map((p) => p.id);
  const staleFeedKeys = [
    // A provider's default-calendar feed exists whether or not it is allowlisted
    // (M365 mints one per connection), so it is included unconditionally.
    ...providerIds.map((provider) => feedKeys.calendarMember(provider, adminId)),
    ...adminTodoRows.map((row) => feedKeys.todoMember(row.provider, adminId, row.listId)),
    ...adminCalendarRows.map((row) => feedKeys.calendarList(row.provider, adminId, row.calendarId)),
  ];
  if (staleFeedKeys.length > 0) {
    const syncState = await tx.delete(integrationSyncState)
      .where(inArray(integrationSyncState.feedKey, staleFeedKeys));
    counts['integration_sync_state'] = syncState.count;
  }
```

and add the calendar-allowlist delete beside the existing `todo_list_allowlist` one:

```ts
  const calAllowlist = await tx.delete(calendarAllowlist).where(eq(calendarAllowlist.memberId, adminId));
  counts['calendar_allowlist'] = calAllowlist.count;
```

Add the two imports (`listProviders` from `../integrations/registry.js`, `calendarAllowlist` from `../modules/calendar/allowlist-schema.js`).

Note the connection delete at `maintenance-admin.ts:153` is provider-UNscoped, deleting by `memberId` alone, and that is CORRECT — stripping the admin's data should remove every connection they hold. Do not add a provider filter there.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/maintenance-admin-repair.test.ts tests/maintenance-admin.test.ts tests/maintenance-admin-error.test.ts && npm run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/household/maintenance-admin.ts tests/maintenance-admin-repair.test.ts
git commit -m "fix(household): clear admin feed state for every provider, not just m365"
```

---

### Task 14: Provider-tagged connections and household-calendar health on `/status`

`/status` returns a single `connection` — "the first non-null across providers". With two providers that is wrong in a way the web cannot recover from: a member connected only to Google would have their Google connection rendered as the M365 card's. The endpoint must also surface the designated household calendar's health, because a designated member disconnecting silently stops the family feed.

**Files:**
- Modify: `src/integrations/routes.ts:44-76`
- Test: `tests/integrations-routes.test.ts` (append / update the `/status` block)

**Interfaces:**
- Consumes: `getHouseholdCalendar` (Task 5), `getHouseholdFeed` (`src/modules/tasks/store.js`).
- Produces the `/status` response shape:
  ```ts
  {
    myConnections: Array<PublicIntegrationConnection & { provider: string }>,
    connections?: Array<PublicIntegrationConnection & { provider: string }>, // admin/adult only
    feeds: PublicFeed[],
    householdListDesignated: boolean,
    householdCalendar: { provider: string; memberId: string; calendarName: string | null; connectionOk: boolean } | null,
    providers: string[],
  }
  ```
  The old single `connection` field is REMOVED — no alias, matching the Phase-1 decision on retiring `/api/v1/m365/*`.

- [ ] **Step 1: Write the failing test**

Append to `tests/integrations-routes.test.ts`:

```ts
describe('GET /api/v1/integrations/status with two providers', () => {
  it('tags the acting member\'s own connections with their provider', async () => {
    const { adult } = await seedTestHousehold();
    registerFakeProvider('m365');   // this suite's existing helper
    registerFakeProvider('google');
    await new IntegrationStore('google').upsertConnection({
      memberId: adult.user.id, accountLabel: 'anna@gmail.test', refreshToken: 'r', scopes: '',
    });

    const res = await app.request('/api/v1/integrations/status', { headers: authHeaders(adult.jwt) });
    const { data } = await res.json() as {
      data: { myConnections: Array<{ provider: string; accountLabel: string }> };
    };
    expect(data.myConnections).toEqual([
      expect.objectContaining({ provider: 'google', accountLabel: 'anna@gmail.test' }),
    ]);
  });

  it('reports no household calendar when none is designated', async () => {
    const { adult } = await seedTestHousehold();
    const res = await app.request('/api/v1/integrations/status', { headers: authHeaders(adult.jwt) });
    const { data } = await res.json() as { data: { householdCalendar: unknown } };
    expect(data.householdCalendar).toBeNull();
  });

  it('reports the designated household calendar as disconnected when its member has no connection', async () => {
    const { adult } = await seedTestHousehold();
    registerFakeProvider('google');
    await setCalendarAllowlist(adult.user.id, 'google', [{ id: 'cal-a', name: 'Familie' }]);
    await setHouseholdCalendar(adult.user.id, 'google', 'cal-a');

    const res = await app.request('/api/v1/integrations/status', { headers: authHeaders(adult.jwt) });
    const { data } = await res.json() as {
      data: { householdCalendar: { calendarName: string; connectionOk: boolean } };
    };
    expect(data.householdCalendar).toMatchObject({ calendarName: 'Familie', connectionOk: false });
  });

  it('reports it as connected once that member connects', async () => {
    const { adult } = await seedTestHousehold();
    registerFakeProvider('google');
    await new IntegrationStore('google').upsertConnection({
      memberId: adult.user.id, accountLabel: 'anna@gmail.test', refreshToken: 'r', scopes: '',
    });
    await setCalendarAllowlist(adult.user.id, 'google', [{ id: 'cal-a', name: 'Familie' }]);
    await setHouseholdCalendar(adult.user.id, 'google', 'cal-a');

    const res = await app.request('/api/v1/integrations/status', { headers: authHeaders(adult.jwt) });
    const { data } = await res.json() as { data: { householdCalendar: { connectionOk: boolean } } };
    expect(data.householdCalendar.connectionOk).toBe(true);
  });

  it('still scopes the household-wide connections list to admin and adult', async () => {
    const { child } = await seedTestHousehold();
    registerFakeProvider('google');
    const res = await app.request('/api/v1/integrations/status', { headers: authHeaders(child.jwt) });
    const { data } = await res.json() as { data: { connections?: unknown; myConnections: unknown[] } };
    expect(data.connections).toBeUndefined();
    expect(data.myConnections).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integrations-routes.test.ts`
Expected: FAIL — `myConnections` and `householdCalendar` are undefined.

- [ ] **Step 3: Write the implementation**

Replace the `/status` handler in `src/integrations/routes.ts`:

```ts
integrationsRouter.get('/status', requireAuth, async (c) => {
  const auth = c.get('auth');
  const providers = listProviders();
  // Sync state is not provider-scoped: one call returns every feed the
  // household has, which is exactly what the wall needs.
  const feeds = providers.length > 0
    ? (await providers[0]!.store.listSyncState()).map(toPublicFeed)
    : [];

  const householdListDesignated = (await getHouseholdFeed()) !== null;

  // The designated family calendar is a DELEGATED feed on one member's
  // connection (no Workspace service account, so it works for consumer Gmail).
  // The accepted cost is that it stops when that member disconnects, so the
  // health of that one connection is reported here rather than left to be
  // discovered as a silently empty wall.
  const householdCalendarFeed = await getHouseholdCalendar();
  let householdCalendar: {
    provider: string; memberId: string; calendarName: string | null; connectionOk: boolean;
  } | null = null;
  if (householdCalendarFeed) {
    const owner = getProvider(householdCalendarFeed.provider);
    const conn = owner ? await owner.store.getConnection(householdCalendarFeed.memberId) : null;
    householdCalendar = {
      provider: householdCalendarFeed.provider,
      memberId: householdCalendarFeed.memberId,
      calendarName: householdCalendarFeed.calendarName,
      connectionOk: conn !== null && conn.status === 'active',
    };
  }

  // The acting member's OWN connections, one per provider they have linked.
  // Provider-tagged, and a list rather than a single row: the old "first
  // non-null across providers" would have rendered a Google connection on the
  // Microsoft card as soon as a second provider existed.
  const myConnections = (await Promise.all(providers.map(async (p) => {
    const row = await p.store.getConnection(auth.userId);
    return row ? { ...row, provider: p.id } : null;
  }))).filter((r) => r !== null);

  if (auth.role === 'admin' || auth.role === 'adult') {
    const connections = (await Promise.all(providers.map(async (p) =>
      (await p.store.listConnections()).map((row) => ({ ...row, provider: p.id }))))).flat();
    return ok(c, {
      myConnections, connections, feeds, householdListDesignated, householdCalendar,
      providers: providers.map((p) => p.id),
    });
  }

  // Children stay scoped to their own connections.
  return ok(c, {
    myConnections, feeds, householdListDesignated, householdCalendar,
    providers: providers.map((p) => p.id),
  });
});
```

Add the `getHouseholdCalendar` import from `../modules/calendar/allowlist-store.js`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/integrations-routes.test.ts tests/google-routes.test.ts && npm run typecheck`
Expected: PASS, typecheck clean. The backend web-facing shape changed, so `cd web && npm run build` will now fail — Task 15 repairs it, which is the correct order.

- [ ] **Step 5: Commit**

```bash
git add src/integrations/routes.ts tests/integrations-routes.test.ts
git commit -m "feat(integrations): tag connections by provider and report household-calendar health"
```

---

### Task 15: Web — provider-neutral status and the Google connection card

**Files:**
- Create: `web/src/api/google.ts`, `web/src/hooks/use-google.ts`
- Modify: `web/src/api/m365.ts`, `web/src/hooks/use-m365.ts`, `web/src/lib/providers.ts`, `web/src/lib/constants.ts` (query keys), `web/src/i18n/locales/en.json`, `web/src/i18n/locales/de.json`
- Test: `web/src/lib/providers.test.ts`, `web/src/hooks/use-m365.test.ts` (update), `web/src/hooks/use-google.test.ts`

**Interfaces:**
- Consumes: the `/status` shape from Task 14.
- Produces:
  - `web/src/api/m365.ts`: `IntegrationConnection { memberId; provider; accountLabel; status; lastRefreshSuccessAt; lastRefreshError }`, `IntegrationsStatus { myConnections: IntegrationConnection[]; connections?: IntegrationConnection[]; feeds: FeedStatus[]; householdListDesignated: boolean; householdCalendar: HouseholdCalendarStatus | null; providers: string[] }`, `HouseholdCalendarStatus { provider; memberId; calendarName: string | null; connectionOk: boolean }`.
  - `useProviderStatus(providerId: string): { state: ProviderState; connection: ProviderConnection | null; isLoading: boolean }` — ONE derived hook parameterised by provider id, replacing `useM365ProviderStatus` and any per-provider copy of it.
  - `web/src/api/google.ts`: `getGoogleConnectUrl()`, `disconnectGoogle()`.

- [ ] **Step 1: Write the failing test**

Update `web/src/lib/providers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { PROVIDERS } from './providers';

describe('PROVIDERS registry', () => {
  it('registers Microsoft 365 with its capabilities', () => {
    const m365 = PROVIDERS.find((p) => p.id === 'm365');
    expect(m365).toBeDefined();
    expect(m365!.capabilities).toEqual(['calendar', 'tasks']);
  });

  it('registers Google with its capabilities', () => {
    const google = PROVIDERS.find((p) => p.id === 'google');
    expect(google).toBeDefined();
    expect(google!.capabilities).toEqual(['calendar', 'tasks']);
  });

  it('gives every provider the full API surface and distinct i18n keys', () => {
    const nameKeys = new Set<string>();
    for (const p of PROVIDERS) {
      expect(typeof p.api.useStatus).toBe('function');
      expect(typeof p.api.getConnectUrl).toBe('function');
      expect(typeof p.api.disconnect).toBe('function');
      expect(p.nameKey).toBeTruthy();
      expect(p.descriptionKey).toBeTruthy();
      nameKeys.add(p.nameKey);
    }
    expect(nameKeys.size).toBe(PROVIDERS.length);
  });
});
```

Create `web/src/hooks/use-google.test.ts`, modelled on the existing `use-m365.test.ts` (copy its query-client wrapper and mocking style verbatim):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/api/m365', () => ({ getIntegrationsStatus: vi.fn() }));

import { getIntegrationsStatus } from '@/api/m365';
import { renderHookWithClient } from '@/test/render';  // whatever use-m365.test.ts uses
import { useProviderStatus } from './use-m365';

const mockStatus = (data: unknown) =>
  (getIntegrationsStatus as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ data });

beforeEach(() => { vi.clearAllMocks(); });

describe('useProviderStatus', () => {
  it('reports unavailable when the provider is not registered', async () => {
    mockStatus({ myConnections: [], feeds: [], providers: ['m365'], householdListDesignated: false, householdCalendar: null });
    const { result } = renderHookWithClient(() => useProviderStatus('google'));
    await vi.waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.state).toBe('unavailable');
  });

  it('reports disconnected when registered but the member has no connection', async () => {
    mockStatus({ myConnections: [], feeds: [], providers: ['google'], householdListDesignated: false, householdCalendar: null });
    const { result } = renderHookWithClient(() => useProviderStatus('google'));
    await vi.waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.state).toBe('disconnected');
  });

  it('picks the connection belonging to ITS OWN provider, not the first one', async () => {
    mockStatus({
      myConnections: [
        { provider: 'm365', memberId: 'm', accountLabel: 'anna@contoso.test', status: 'active', lastRefreshSuccessAt: null, lastRefreshError: null },
        { provider: 'google', memberId: 'm', accountLabel: 'anna@gmail.test', status: 'needs_reauth', lastRefreshSuccessAt: null, lastRefreshError: 'expired' },
      ],
      feeds: [], providers: ['m365', 'google'], householdListDesignated: false, householdCalendar: null,
    });
    const { result } = renderHookWithClient(() => useProviderStatus('google'));
    await vi.waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.connection!.accountLabel).toBe('anna@gmail.test');
    expect(result.current.state).toBe('needs_reauth');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/providers.test.ts src/hooks/use-google.test.ts`
Expected: FAIL — no Google entry, no `useProviderStatus`.

- [ ] **Step 3: Repoint the status API types**

In `web/src/api/m365.ts`, replace `M365Connection` / `M365Status` / `getM365Status` (keep the file — it is where the shared status query lives — and rename the exports so nothing reads as Microsoft-only):

```ts
/** One member's connection to ONE provider, as `/integrations/status` returns it. */
export interface IntegrationConnection {
  provider: string;
  memberId: string;
  accountLabel: string;
  status: string;
  lastRefreshSuccessAt: string | null;
  lastRefreshError: string | null;
}

/** Health of the designated household (family) calendar, or null when none. */
export interface HouseholdCalendarStatus {
  provider: string;
  memberId: string;
  calendarName: string | null;
  /** False when the designating member's connection is missing or dead — the
   *  family feed is then silently stopped until an adult designates another. */
  connectionOk: boolean;
}

/**
 * GET /api/v1/integrations/status — the provider-neutral health surface. Always
 * 200: with no provider registered it reports empty lists, which is the honest
 * answer rather than an error worth surfacing on the wall.
 */
export interface IntegrationsStatus {
  /** The acting member's own connections, one per provider they have linked. */
  myConnections: IntegrationConnection[];
  /** Household-wide, admin/adult only. */
  connections?: IntegrationConnection[];
  feeds: FeedStatus[];
  householdListDesignated: boolean;
  householdCalendar: HouseholdCalendarStatus | null;
  providers: string[];
}

export function getIntegrationsStatus(): Promise<SingleResponse<IntegrationsStatus>> {
  return apiGet('/integrations/status');
}
```

Keep `triggerM365Sync` but rename it `triggerIntegrationsSync` (it already posts to `/integrations/sync`), and replace `getM365ConnectUrl` / `disconnectM365` with provider-parameterised twins:

```ts
/** The consent URL, fetched as JSON because a navigation cannot carry the Bearer token. */
export function getConnectUrl(provider: string): Promise<SingleResponse<{ url: string }>> {
  return apiGet(`/integrations/${provider}/connect-url`);
}

export function disconnectProvider(provider: string): Promise<SingleResponse<{ disconnected: boolean }>> {
  return apiDelete(`/integrations/${provider}/connection`);
}
```

- [ ] **Step 4: Parameterise the derived hook**

In `web/src/hooks/use-m365.ts`, keep `useM365FeedStatus` (rename to `useIntegrationsFeedStatus`, updating its callers) and `useM365Status` (rename `useIntegrationsStatus`), and replace `useM365ProviderStatus` with:

```ts
/**
 * Derived per-member view for ONE provider, used by the provider registry.
 *
 * Parameterised rather than duplicated per provider: the previous version read
 * `data.connection`, "the first non-null across providers", which would have
 * rendered a Google connection on the Microsoft card the moment a second
 * provider existed. It now selects from `myConnections` BY PROVIDER.
 *
 * A provider missing from `providers[]` is `unavailable`, not an error: the
 * endpoint is provider-neutral and 200s with `providers: []` when nothing is
 * configured.
 */
export function useProviderStatus(providerId: string): {
  state: ProviderState;
  connection: ProviderConnection | null;
  isLoading: boolean;
} {
  const query = useIntegrationsStatus();

  const notMounted =
    (query.error instanceof ApiError && query.error.status === 404) ||
    (query.data !== undefined && !query.data.data.providers.includes(providerId));
  const raw = query.data?.data.myConnections.find((cnx) => cnx.provider === providerId) ?? null;

  const connection: ProviderConnection | null = raw
    ? {
        memberId: raw.memberId,
        accountLabel: raw.accountLabel,
        lastSuccessAt: raw.lastRefreshSuccessAt,
        lastError: raw.lastRefreshError,
      }
    : null;

  const state: ProviderState = notMounted
    ? 'unavailable'
    : !raw
      ? 'disconnected'
      : raw.status === 'active'
        ? 'connected'
        : 'needs_reauth';

  return { state, connection, isLoading: query.isLoading };
}
```

- [ ] **Step 5: Add the Google API adapter**

Create `web/src/api/google.ts`:

```ts
import { getConnectUrl, disconnectProvider } from './m365';
import type { SingleResponse } from '@/lib/types';

/**
 * Google connection adapter. The routes are provider-scoped, so these are thin
 * bindings of the shared helpers rather than a second copy of them — the M365
 * adapter is the same two calls with a different id.
 */
export function getGoogleConnectUrl(): Promise<SingleResponse<{ url: string }>> {
  return getConnectUrl('google');
}

export function disconnectGoogle(): Promise<SingleResponse<{ disconnected: boolean }>> {
  return disconnectProvider('google');
}
```

Create `web/src/hooks/use-google.ts`:

```ts
import { useProviderStatus } from './use-m365';

/** Google's binding of the shared derived status hook. */
export function useGoogleProviderStatus() {
  return useProviderStatus('google');
}
```

- [ ] **Step 6: Register Google in `PROVIDERS`**

In `web/src/lib/providers.ts`, add the entry (and rewrite the M365 entry's `useStatus` to `() => useProviderStatus('m365')`):

```ts
import { CalendarDays, Cloud, type LucideIcon } from 'lucide-react';
import { getGoogleConnectUrl, disconnectGoogle } from '@/api/google';
import { useGoogleProviderStatus } from '@/hooks/use-google';

// … existing types unchanged …

export const PROVIDERS: ConnectionProvider[] = [
  {
    id: 'm365',
    nameKey: 'connections.m365.name',
    descriptionKey: 'connections.m365.description',
    capabilities: ['calendar', 'tasks'],
    icon: Cloud,
    api: {
      useStatus: () => useProviderStatus('m365'),
      getConnectUrl: async () => (await getConnectUrl('m365')).data.url,
      disconnect: async () => { await disconnectProvider('m365'); },
    },
  },
  {
    id: 'google',
    nameKey: 'connections.google.name',
    descriptionKey: 'connections.google.description',
    capabilities: ['calendar', 'tasks'],
    icon: CalendarDays,
    api: {
      useStatus: useGoogleProviderStatus,
      getConnectUrl: async () => (await getGoogleConnectUrl()).data.url,
      disconnect: async () => { await disconnectGoogle(); },
    },
  },
];
```

- [ ] **Step 7: Add the i18n keys**

Add to `web/src/i18n/locales/en.json` beside `connections.m365`:

```json
"google": {
  "name": "Google",
  "description": "Mirror your Google calendars and sync Google Tasks."
}
```

and to `de.json`:

```json
"google": {
  "name": "Google",
  "description": "Google-Kalender spiegeln und Google Tasks synchronisieren."
}
```

`catalog-parity.test.ts` fails if the two catalogues diverge — run it.

- [ ] **Step 8: Run the tests and the web build**

Run: `cd web && npx vitest run && npm run build`
Expected: PASS and a clean build. Every `getM365Status` / `useM365ProviderStatus` / `triggerM365Sync` caller must be repointed — the build is what enumerates them.

- [ ] **Step 9: Commit**

```bash
git add web/src
git commit -m "feat(web): select connection status per provider and add the Google card"
```

---

### Task 16: Web — provider-aware pickers, household list and household calendar

**Files:**
- Modify: `web/src/api/tasks.ts`, `web/src/hooks/use-tasks.ts`, `web/src/pages/tasks.tsx`, `web/src/lib/types.ts`, `web/src/lib/constants.ts`, `web/src/i18n/locales/en.json`, `web/src/i18n/locales/de.json`
- Create: `web/src/api/calendar-allowlist.ts`, `web/src/hooks/use-calendar-allowlist.ts`, `web/src/components/settings/calendar-sync-settings.tsx`
- Modify: `web/src/pages/profile.tsx` (mount the calendar picker under the connection cards)
- Test: `web/src/pages/tasks.test.tsx` (create if absent), `web/src/components/settings/calendar-sync-settings.test.tsx`

**Interfaces:**
- Consumes: `PUT /api/v1/tasks/allowlist` (`{ lists: [{provider, listId}] }`, Task 12), `PUT /api/v1/tasks/household-list` (`{provider, listId}`, shipped in Phase 1 with no UI), `GET /api/v1/calendar/calendars`, `PUT /api/v1/calendar/allowlist`, `PUT /api/v1/calendar/household-calendar` (Task 6).
- Produces:
  - `web/src/lib/types.ts`: `AvailableTaskList` gains `provider: string`; `TodoAllowlistEntry` gains `provider: string` and `isHousehold: boolean`; new `AvailableCalendar { provider: string; id: string; name: string; enabled: boolean; isHousehold: boolean }`.
  - `api/tasks.ts`: `setAllowlist(lists: Array<{ provider: string; listId: string }>)`, `setHouseholdList(provider: string, listId: string)`.
  - `api/calendar-allowlist.ts`: `listCalendars()`, `setCalendarAllowlist(calendars)`, `setHouseholdCalendar(provider, calendarId)`.
  - `useAvailableCalendars(enabled)`, `useSetCalendarAllowlist()`, `useSetHouseholdCalendar()`, `useSetHouseholdList()`.

- [ ] **Step 1: Write the failing test**

Create `web/src/components/settings/calendar-sync-settings.test.tsx` (copy the render/mocking harness from an existing page test such as `src/pages/profile.test.tsx`):

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/api/calendar-allowlist', () => ({
  listCalendars: vi.fn(),
  setCalendarAllowlist: vi.fn(),
  setHouseholdCalendar: vi.fn(),
}));

import { listCalendars, setCalendarAllowlist, setHouseholdCalendar } from '@/api/calendar-allowlist';
import { renderWithProviders } from '@/test/render';
import { CalendarSyncSettings } from './calendar-sync-settings';

const mocked = (fn: unknown) => fn as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mocked(setCalendarAllowlist).mockResolvedValue({ data: [] });
  mocked(setHouseholdCalendar).mockResolvedValue({ data: null });
});

describe('CalendarSyncSettings', () => {
  it('groups calendars by provider and shows which are synced', async () => {
    mocked(listCalendars).mockResolvedValue({ data: [
      { provider: 'google', id: 'cal-a', name: 'Anna', enabled: true, isHousehold: false },
      { provider: 'google', id: 'cal-b', name: 'Sport', enabled: false, isHousehold: false },
    ] });

    renderWithProviders(<CalendarSyncSettings canDesignate />);

    expect(await screen.findByLabelText('Anna')).toBeChecked();
    expect(screen.getByLabelText('Sport')).not.toBeChecked();
  });

  it('submits the full desired selection, provider-tagged', async () => {
    mocked(listCalendars).mockResolvedValue({ data: [
      { provider: 'google', id: 'cal-a', name: 'Anna', enabled: true, isHousehold: false },
      { provider: 'google', id: 'cal-b', name: 'Sport', enabled: false, isHousehold: false },
    ] });

    renderWithProviders(<CalendarSyncSettings canDesignate />);
    await userEvent.click(await screen.findByLabelText('Sport'));

    await waitFor(() => expect(setCalendarAllowlist).toHaveBeenCalledWith([
      { provider: 'google', calendarId: 'cal-a' },
      { provider: 'google', calendarId: 'cal-b' },
    ]));
  });

  it('offers the household radio only for a synced calendar, and only to an adult', async () => {
    mocked(listCalendars).mockResolvedValue({ data: [
      { provider: 'google', id: 'cal-a', name: 'Anna', enabled: true, isHousehold: false },
      { provider: 'google', id: 'cal-b', name: 'Sport', enabled: false, isHousehold: false },
    ] });

    const { rerender } = renderWithProviders(<CalendarSyncSettings canDesignate />);
    await screen.findByLabelText('Anna');
    expect(screen.getAllByRole('radio')).toHaveLength(1);

    rerender(<CalendarSyncSettings canDesignate={false} />);
    await waitFor(() => expect(screen.queryAllByRole('radio')).toHaveLength(0));
  });

  it('designates the household calendar when the radio is picked', async () => {
    mocked(listCalendars).mockResolvedValue({ data: [
      { provider: 'google', id: 'cal-a', name: 'Anna', enabled: true, isHousehold: false },
    ] });

    renderWithProviders(<CalendarSyncSettings canDesignate />);
    await userEvent.click(await screen.findByRole('radio'));

    await waitFor(() => expect(setHouseholdCalendar).toHaveBeenCalledWith('google', 'cal-a'));
  });
});
```

Add the equivalent to the tasks page test for the To Do picker: a provider-tagged `setAllowlist` payload, and a household-list radio that calls `setHouseholdList('google', 'g-1')`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/components/settings/calendar-sync-settings.test.tsx`
Expected: FAIL — the component does not exist.

- [ ] **Step 3: Update the types and the tasks API**

In `web/src/lib/types.ts`:

```ts
export interface AvailableTaskList {
  /** Which provider this list belongs to — a member may hold lists at both. */
  provider: string;
  id: string;
  name: string;
  enabled: boolean;
}

export interface TodoAllowlistEntry {
  id: string;
  provider: string;
  memberId: string;
  listId: string;
  listName: string | null;
  /** THE household list: what Heorth (and Weorc) create tasks into. */
  isHousehold: boolean;
}

/** One calendar from `GET /api/v1/calendar/calendars`. */
export interface AvailableCalendar {
  provider: string;
  id: string;
  name: string;
  enabled: boolean;
  isHousehold: boolean;
}
```

In `web/src/api/tasks.ts`:

```ts
export function setAllowlist(
  lists: Array<{ provider: string; listId: string }>,
): Promise<SingleResponse<TodoAllowlistEntry[]>> {
  return apiPut('/tasks/allowlist', { lists });
}

/** Designate the household task list (admin/adult only, enforced server-side). */
export function setHouseholdList(
  provider: string, listId: string,
): Promise<SingleResponse<unknown>> {
  return apiPut('/tasks/household-list', { provider, listId });
}
```

- [ ] **Step 4: Add the calendar allowlist API and hooks**

Create `web/src/api/calendar-allowlist.ts`:

```ts
import { apiGet, apiPut } from './client';
import type { SingleResponse, AvailableCalendar } from '@/lib/types';

/**
 * Calendar discovery and selection — the sibling of the To Do list picker's
 * API. Nothing mirrors until a member picks a calendar here.
 */
export function listCalendars(): Promise<SingleResponse<AvailableCalendar[]>> {
  return apiGet('/calendar/calendars');
}

export function setCalendarAllowlist(
  calendars: Array<{ provider: string; calendarId: string }>,
): Promise<SingleResponse<unknown[]>> {
  return apiPut('/calendar/allowlist', { calendars });
}

/** Designate the shared family calendar (admin/adult only, enforced server-side). */
export function setHouseholdCalendar(
  provider: string, calendarId: string,
): Promise<SingleResponse<unknown>> {
  return apiPut('/calendar/household-calendar', { provider, calendarId });
}
```

Create `web/src/hooks/use-calendar-allowlist.ts` following the shape of `use-tasks.ts` (a `useQuery` on a new `QUERY_KEYS.calendarList` key plus three mutations, each invalidating that key). Add `calendarList` to `QUERY_KEYS` in `web/src/lib/constants.ts`.

- [ ] **Step 5: Write the calendar picker component**

Create `web/src/components/settings/calendar-sync-settings.tsx`. It renders one section per provider (grouped by `provider`, with the provider's own `nameKey` from `PROVIDERS` as the heading), a checkbox per calendar, and — only when `canDesignate` and the calendar is enabled — a radio marking the household calendar. On toggle it submits the FULL desired selection across every provider currently displayed, exactly as `ListSettings` in `tasks.tsx` already does for lists:

```tsx
const toggle = async (provider: string, calendarId: string, enabled: boolean) => {
  const next = calendars
    .filter((c) => (c.provider === provider && c.id === calendarId ? enabled : c.enabled))
    .map((c) => ({ provider: c.provider, calendarId: c.id }));
  await setAllowlistMutation.mutateAsync(next);
};
```

Mount it in `web/src/pages/profile.tsx` beneath the `PROVIDERS.map(...)` block, passing `canDesignate={role === 'admin' || role === 'adult'}` from the session, and skip it for the maintenance admin exactly as the connection cards already are.

- [ ] **Step 6: Make the To Do picker provider-aware**

In `web/src/pages/tasks.tsx`'s `ListSettings`: group `lists` by `provider`, submit `{ provider, listId }` pairs, and add the household-list radio (adult/admin only) beside each enabled list, wired to `useSetHouseholdList()`. The radio's checked state comes from the allowlist query's `isHousehold`.

The household-list designation route shipped in Phase 1 with NO user interface, so an upgraded deployment currently has no way to designate one — which silently disables Weorc's projection. This radio is what closes that, and it is why the picker work is not optional.

- [ ] **Step 7: Add the i18n keys**

Add matching `en.json` / `de.json` entries for the calendar picker (title, hint, "household calendar" radio label, empty state, error) and the household-list radio label. Run `npx vitest run src/i18n/catalog-parity.test.ts`.

- [ ] **Step 8: Run the tests and the build**

Run: `cd web && npx vitest run && npm run build`
Expected: PASS and a clean build.

- [ ] **Step 9: Commit**

```bash
git add web/src
git commit -m "feat(web): add provider-aware calendar and list pickers with household designation"
```

---

### Task 17: Documentation

**Files:**
- Modify: `AGENTS.md` (the "Integration provider rules" section), `README.md`, `CHANGELOG.md`

- [ ] **Step 1: Update `AGENTS.md`**

Edit the "Integration provider rules (`src/integrations/`, `src/m365/`)" heading to include `src/google/`, and revise these bullets to state what is now true:

- **Containment** — `src/google/` is live, not "(phase 2)"; Google URLs live in `src/google/api.ts`.
- **Feed keys are NOT opaque** — add that the GOOGLE providers deliberately do NOT parse them: they resolve a feed from its `calendar_allowlist` / `todo_list_allowlist` row (`getCalendarFeedByKey`, `getTaskFeedByKey`), because a Google calendar id is email-shaped and would split. Making the M365 providers do the same is still a worthwhile follow-up.
- **Optional-as-a-group credentials** — `GOOGLE_*` is now a real three-variable group, not "(phase 2)". Add `GOOGLE_FULL_RESYNC_INTERVAL_SECONDS` beside `M365_FULL_RESYNC_INTERVAL_SECONDS` as a non-credential knob.
- Add a new bullet: **Google Tasks pulls a SNAPSHOT, never a delta.** `GoogleTaskProvider.pullChanges` ignores the sync token and reports `fullResync: true` on every pull; `applyTaskPull` reconciles. Do not "optimise" this into an `updatedMin` delta — deletions would then depend on Google's tombstone retention and a task deleted on a phone would stay mirrored forever. `showCompleted=true&showHidden=true` are both mandatory: without them a completion reads as a deletion.
- Add a new bullet: **The Google family calendar is a designated allowlist row**, `calendar_allowlist.is_household`, on ONE member's delegated connection — there is no app-only Google client and no `GOOGLE_FAMILY_*` env. It stops when that member disconnects; `/api/v1/integrations/status`'s `householdCalendar.connectionOk` is where that shows.
- Update the `src/m365/sync-runner.ts` bullet to note `src/google/sync-runner.ts` is its sibling and equally runs nothing.

- [ ] **Step 2: Update `README.md`**

- Add the `GOOGLE_*` group to the env reference, with the Google Cloud console setup: create an OAuth client (type "Web application"), configure the consent screen, add the redirect URI `<base>/api/v1/integrations/google/callback`, and **enable both the Google Calendar API and the Google Tasks API** on the project (a missing API surfaces as a 403 `accessNotConfigured`, not as a scope error).
- Document the scopes requested and that `access_type=offline` + `prompt=consent` are mandatory, with the one-line reason.
- Document the new routes: `GET /api/v1/calendar/calendars`, `PUT /api/v1/calendar/allowlist`, `PUT /api/v1/calendar/household-calendar`, and the CHANGED `PUT /api/v1/tasks/allowlist` body (`{ lists: [{provider, listId}] }`, no `listIds` alias).
- Document the changed `/api/v1/integrations/status` shape (`myConnections` replaces `connection`; `householdCalendar` is new).
- State plainly, as an upgrade note: **nothing syncs from Google until a member picks calendars and lists, and no family calendar exists until an adult designates one.**

- [ ] **Step 3: Update `CHANGELOG.md`**

Add an Unreleased entry covering: the Google provider (Calendar mirror + Tasks with write-back), the `calendar_allowlist` table and migration `0027`, the provider-aware task allowlist API as a **breaking** request-shape change, the `/status` shape change as **breaking**, and the maintenance-admin multi-provider fix. Do not rewrite older release sections — they describe what was true at their release.

- [ ] **Step 4: Verify the whole branch**

Run:
```bash
npm run typecheck && npm test && (cd web && npm test && npm run build)
```
Expected: all green. Record the file/test counts.

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md README.md CHANGELOG.md
git commit -m "docs: document the Google provider, the calendar allowlist and the API changes"
```

---

## Operator actions (NOT code — surface these to the user when the branch is done)

These are outside the repository and cannot be done from a task:

1. **Create the Google Cloud OAuth client.** Consent screen configured, redirect URI `<base>/api/v1/integrations/google/callback` registered, and BOTH the Google Calendar API and the Google Tasks API enabled on the project.
2. **Add `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` to `deploy/.env`** — that file lives in the META repo and is a git-ignored secret. One change, one repo, one commit: it is not edited from this repo's branch.
3. **Confirm the dev redirect host.** Whether the dev stack's OAuth client can use a `localhost` redirect or needs a tunnelled host is a Google Cloud console constraint, not a code one — spec Open Question 2. Settle it before the first real connect attempt.
4. **After deploying:** an adult must designate the household task list and the household calendar in the settings UI. Neither is backfilled, and until the task list is designated Weorc's projection stays disabled.
5. **Meta repo:** ADR 0001 predicted a second provider but did not decide its shape. A short ADR recording provider-scoped connections, the snapshot/reconcile pull mode and designation-by-flag belongs in `~/projects/Wyrhta/docs/decisions/` — a separate commit in the meta repo, not here.

## Self-review notes

- **Spec coverage.** Every Phase-2 section maps to a task: config → 1; hazards (transport, classification, refresh token) → 2–4; `calendar_allowlist` and discovery → 5–6; `GoogleCalendarProvider` → 7–8; `GoogleTaskProvider` → 9–10; registration → 11; the two Phase-1 findings embedded in the spec → 12 (allowlist API) and 13 (maintenance-admin landmine); the status surface for a stopped family feed → 14; web → 15–16; docs → 17.
- **Deliberately out of scope.** Making the M365 providers resolve feeds from their allowlist rows instead of parsing feed keys (a behaviour change inside another provider, worth its own change); CalDAV or any third provider; calendar write-back for either provider.
- **Ordering that matters.** Task 14 breaks the web build on purpose and Task 15 repairs it — do not reorder them. Task 12 changes a request shape the web sends, so Task 16 must follow it. Task 11 must land after 7–10 or the module cannot construct its providers.

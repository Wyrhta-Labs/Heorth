import { Hono } from 'hono';
import type { M365Config } from '../src/config/env.js';
import { createM365Runtime, type M365Runtime } from '../src/m365/index.js';
import { DELEGATED_SCOPES } from '../src/m365/delegated.js';

/**
 * In-process fake of the Microsoft identity platform (token endpoint) + Graph,
 * mirroring the fake-Feoh pattern. Our M365 clients take an injectable `fetch`;
 * `runtimeForFakeGraph` wires a real store + these fake endpoints so tests never
 * touch a real tenant. Routes by URL pathname only (host is ignored), so the
 * single app serves both `login.microsoftonline.com` and `graph.microsoft.com`.
 */

export interface FakeGraphCall {
  method: string;
  path: string;
  grantType?: string;
  /** Raw query string (no leading `?`), when present — lets tests assert on
   * whether a delta request carried a fresh window (`startDateTime=...`) vs. a
   * replayed token (`$deltatoken=...`/`$skiptoken=...`). */
  query?: string;
}

/** A scripted calendar event (mapped to a Graph event resource by the fake). */
export interface FakeCalEvent {
  id: string;
  subject: string;
  startUtc: string; // ISO-8601 with Z
  endUtc: string;
  allDay?: boolean;
  location?: string;
  organizer?: string;
  timeZone?: string; // originalStartTimeZone
}

/** One delta page: upserted events and/or removed external ids. */
export interface FakeCalPage {
  upserts?: FakeCalEvent[];
  removed?: string[];
}

/**
 * One delta "batch" = the changes returned for a single sync token. Multiple
 * `pages` exercise `@odata.nextLink` paging within one pull; `gone: true` makes
 * the delta request for that batch return `410 Gone` (expired token).
 */
export interface FakeCalBatch {
  pages: FakeCalPage[];
  gone?: boolean;
}

/** A scripted To Do list (mapped to a Graph todoTaskList resource). */
export interface FakeTodoList {
  id: string;
  displayName: string;
}

/** A scripted To Do task (mapped to a Graph todoTask by the fake). */
export interface FakeTodoTask {
  id: string;
  title: string;
  status?: 'open' | 'completed';
  notes?: string;
  dueUtc?: string;
  completedUtc?: string;
}

/** One To Do delta page: upserted tasks and/or removed external ids. */
export interface FakeTodoPage {
  upserts?: FakeTodoTask[];
  removed?: string[];
}

/** One To Do delta batch (same token/paging/gone semantics as FakeCalBatch). */
export interface FakeTodoBatch {
  pages: FakeTodoPage[];
  gone?: boolean;
}

export interface FakeGraph {
  app: Hono;
  calls: FakeGraphCall[];
  /** Number of refresh_token grants served (rotation counter). */
  refreshCount: number;
  /** Number of client_credentials grants served. */
  appTokenCount: number;
  /** When true, the next Graph call returns 429 once (then succeeds). */
  throttleNextGraph: boolean;
  /** When true, refresh_token grants return 400 invalid_grant. */
  failRefresh: boolean;
  /** UPN returned by GET /me. */
  meUpn: string;
  /** Scripted calendarView/delta batches, keyed by 'me' or a mailbox UPN. */
  calendars: Map<string, FakeCalBatch[]>;
  /** Keys whose next calendarView/delta returns a 500 (per-feed error injection). */
  failDelta: Set<string>;
  /** Script a feed's delta batches (key: 'me' for delegated, mailbox for app-only). */
  setCalendar(key: string, batches: FakeCalBatch[]): void;

  // --- To Do ---------------------------------------------------------------
  /** Lists returned by GET /me/todo/lists. */
  todoLists: FakeTodoList[];
  /** Scripted tasks/delta batches, keyed by listId. */
  todoTasks: Map<string, FakeTodoBatch[]>;
  /** listIds whose next tasks/delta returns a 500 (per-feed error injection). */
  failTodoDelta: Set<string>;
  /** Number of tasks created via POST (creation counter). */
  createdTaskCount: number;
  /** Set the discoverable To Do lists. */
  setTodoLists(lists: FakeTodoList[]): void;
  /** Script a list's tasks/delta batches. */
  setTodoTasks(listId: string, batches: FakeTodoBatch[]): void;
}

const TEST_CONFIG: M365Config = {
  tenantId: 'test-tenant-id',
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  redirectUri: 'http://localhost:4000/api/v1/m365/callback',
  familyMailbox: 'family-calendar@contoso.test',
  sharedTodoList: 'Household',
};

export function createFakeGraph(): FakeGraph {
  const state: FakeGraph = {
    app: new Hono(),
    calls: [],
    refreshCount: 0,
    appTokenCount: 0,
    throttleNextGraph: false,
    failRefresh: false,
    meUpn: 'member@contoso.test',
    calendars: new Map(),
    failDelta: new Set(),
    setCalendar(key, batches) { state.calendars.set(key, batches); },
    todoLists: [],
    todoTasks: new Map(),
    failTodoDelta: new Set(),
    createdTaskCount: 0,
    setTodoLists(lists) { state.todoLists = lists; },
    setTodoTasks(listId, batches) { state.todoTasks.set(listId, batches); },
  };

  // --- calendarView/delta (used by the Graph calendar provider) -------------
  const toGraphEvent = (e: FakeCalEvent) => ({
    id: e.id,
    subject: e.subject,
    isAllDay: e.allDay ?? false,
    start: { dateTime: e.startUtc, timeZone: 'UTC' },
    end: { dateTime: e.endUtc, timeZone: 'UTC' },
    location: e.location ? { displayName: e.location } : undefined,
    organizer: e.organizer ? { emailAddress: { name: e.organizer } } : undefined,
    originalStartTimeZone: e.timeZone,
  });

  const deltaUrl = (pathname: string, tok: string, kind: 'delta' | 'skip') =>
    `https://graph.microsoft.com${pathname}?$${kind}token=${encodeURIComponent(tok)}`;

  const handleDelta = (c: any, key: string) => {
    const url = new URL(c.req.url);
    const pathname = url.pathname;
    state.calls.push({ method: 'GET', path: pathname, query: url.search.replace(/^\?/, '') });

    if (state.failDelta.has(key)) {
      return c.json({ error: { code: 'InternalServerError', message: 'boom' } }, 500);
    }

    const batches = state.calendars.get(key) ?? [];
    const token = c.req.query('$deltatoken') ?? c.req.query('$skiptoken');
    let bi = 0;
    let pi = 0;
    if (token) { const [b, p] = token.split('.'); bi = Number(b); pi = Number(p); }

    const batch = batches[bi];
    if (batch?.gone) {
      return c.json({ error: { code: 'syncStateNotFound', message: 'delta token expired' } }, 410);
    }
    if (!batch) {
      // No changes beyond what we've served — stable deltaLink, empty value.
      return c.json({ value: [], '@odata.deltaLink': deltaUrl(pathname, `${bi}.0`, 'delta') });
    }

    const page = batch.pages[pi] ?? {};
    const value = [
      ...(page.upserts ?? []).map(toGraphEvent),
      ...(page.removed ?? []).map((id) => ({ id, '@removed': { reason: 'deleted' } })),
    ];
    const hasMorePages = pi + 1 < batch.pages.length;
    if (hasMorePages) {
      return c.json({ value, '@odata.nextLink': deltaUrl(pathname, `${bi}.${pi + 1}`, 'skip') });
    }
    return c.json({ value, '@odata.deltaLink': deltaUrl(pathname, `${bi + 1}.0`, 'delta') });
  };

  state.app.get('/v1.0/me/calendarView/delta', (c) => handleDelta(c, 'me'));
  state.app.get('/v1.0/users/:mailbox/calendarView/delta', (c) => handleDelta(c, c.req.param('mailbox')));

  // --- To Do (used by the Graph task provider) ------------------------------
  const toGraphTask = (t: FakeTodoTask) => ({
    id: t.id,
    title: t.title,
    status: t.status === 'completed' ? 'completed' : 'notStarted',
    body: t.notes ? { content: t.notes, contentType: 'text' } : undefined,
    dueDateTime: t.dueUtc ? { dateTime: t.dueUtc, timeZone: 'UTC' } : undefined,
    completedDateTime: t.completedUtc ? { dateTime: t.completedUtc, timeZone: 'UTC' } : undefined,
  });

  const todoDeltaUrl = (pathname: string, tok: string, kind: 'delta' | 'skip') =>
    `https://graph.microsoft.com${pathname}?$${kind}token=${encodeURIComponent(tok)}`;

  // GET /me/todo/lists — list discovery.
  state.app.get('/v1.0/me/todo/lists', (c) => {
    state.calls.push({ method: 'GET', path: '/v1.0/me/todo/lists' });
    return c.json({ value: state.todoLists.map((l) => ({ id: l.id, displayName: l.displayName })) });
  });

  // GET /me/todo/lists/:listId/tasks/delta — incremental sync.
  state.app.get('/v1.0/me/todo/lists/:listId/tasks/delta', (c) => {
    const listId = c.req.param('listId');
    const url = new URL(c.req.url);
    state.calls.push({ method: 'GET', path: url.pathname, query: url.search.replace(/^\?/, '') });

    if (state.failTodoDelta.has(listId)) {
      return c.json({ error: { code: 'InternalServerError', message: 'boom' } }, 500);
    }

    const batches = state.todoTasks.get(listId) ?? [];
    const token = c.req.query('$deltatoken') ?? c.req.query('$skiptoken');
    let bi = 0;
    let pi = 0;
    if (token) { const [b, p] = token.split('.'); bi = Number(b); pi = Number(p); }

    const batch = batches[bi];
    if (batch?.gone) {
      return c.json({ error: { code: 'syncStateNotFound', message: 'delta token expired' } }, 410);
    }
    if (!batch) {
      return c.json({ value: [], '@odata.deltaLink': todoDeltaUrl(url.pathname, `${bi}.0`, 'delta') });
    }

    const page = batch.pages[pi] ?? {};
    const value = [
      ...(page.upserts ?? []).map(toGraphTask),
      ...(page.removed ?? []).map((id) => ({ id, '@removed': { reason: 'deleted' } })),
    ];
    const hasMorePages = pi + 1 < batch.pages.length;
    if (hasMorePages) {
      return c.json({ value, '@odata.nextLink': todoDeltaUrl(url.pathname, `${bi}.${pi + 1}`, 'skip') });
    }
    return c.json({ value, '@odata.deltaLink': todoDeltaUrl(url.pathname, `${bi + 1}.0`, 'delta') });
  });

  // PATCH /me/todo/lists/:listId/tasks/:taskId — completion write-back.
  state.app.patch('/v1.0/me/todo/lists/:listId/tasks/:taskId', async (c) => {
    const url = new URL(c.req.url);
    state.calls.push({ method: 'PATCH', path: url.pathname });
    const body = await c.req.json().catch(() => ({})) as { status?: string };
    return c.json({ id: c.req.param('taskId'), title: 'task', status: body.status ?? 'notStarted' });
  });

  // POST /me/todo/lists/:listId/tasks — creation.
  state.app.post('/v1.0/me/todo/lists/:listId/tasks', async (c) => {
    const url = new URL(c.req.url);
    state.calls.push({ method: 'POST', path: url.pathname });
    const body = await c.req.json().catch(() => ({})) as {
      title?: string; body?: { content?: string }; dueDateTime?: { dateTime?: string };
    };
    state.createdTaskCount += 1;
    return c.json({
      id: `todo-created-${state.createdTaskCount}`,
      title: body.title ?? '(untitled)',
      status: 'notStarted',
      body: body.body,
      dueDateTime: body.dueDateTime,
    }, 201);
  });

  // Identity: token endpoint (authorization_code / refresh_token / client_credentials).
  state.app.post('/:tenant/oauth2/v2.0/token', async (c) => {
    const form = await c.req.parseBody();
    const grantType = String(form['grant_type'] ?? '');
    state.calls.push({ method: 'POST', path: new URL(c.req.url).pathname, grantType });

    if (grantType === 'authorization_code') {
      return c.json({
        token_type: 'Bearer', expires_in: 3600, scope: DELEGATED_SCOPES,
        access_token: 'delegated-access-initial', refresh_token: 'refresh-initial',
      });
    }
    if (grantType === 'refresh_token') {
      if (state.failRefresh) {
        return c.json({ error: 'invalid_grant', error_description: 'refresh token expired' }, 400);
      }
      state.refreshCount += 1;
      return c.json({
        token_type: 'Bearer', expires_in: 3600, scope: DELEGATED_SCOPES,
        access_token: `delegated-access-r${state.refreshCount}`,
        refresh_token: `refresh-r${state.refreshCount}`,
      });
    }
    if (grantType === 'client_credentials') {
      state.appTokenCount += 1;
      return c.json({ token_type: 'Bearer', expires_in: 3600, access_token: `app-access-${state.appTokenCount}` });
    }
    return c.json({ error: 'unsupported_grant_type' }, 400);
  });

  // Graph: /me (used to record the account UPN + as a 429-retry probe target).
  state.app.get('/v1.0/me', (c) => {
    state.calls.push({ method: 'GET', path: '/v1.0/me' });
    if (state.throttleNextGraph) {
      state.throttleNextGraph = false;
      return c.json({ error: { code: 'TooManyRequests', message: 'throttled' } }, 429, { 'Retry-After': '0' });
    }
    return c.json({ id: 'user-object-id', userPrincipalName: state.meUpn, displayName: 'Test User' });
  });

  // Graph: a shared-mailbox user probe (mirrors the smoke script's app-only check).
  state.app.get('/v1.0/users/:mailbox', (c) => {
    state.calls.push({ method: 'GET', path: new URL(c.req.url).pathname });
    return c.json({ id: 'mailbox-object-id', userPrincipalName: c.req.param('mailbox'), displayName: 'Family Calendar' });
  });

  return state;
}

/** Build an M365Runtime whose clients talk to the in-process fake over its fetch. */
export function runtimeForFakeGraph(fake: FakeGraph): M365Runtime {
  const fakeFetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    fake.app.request(input as string, init)) as typeof fetch;
  return createM365Runtime(TEST_CONFIG, fakeFetch);
}

export { TEST_CONFIG as fakeM365Config };

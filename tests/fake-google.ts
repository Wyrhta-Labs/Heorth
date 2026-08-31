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
  // --- calendar ---
  /** Calendars returned by GET /calendar/v3/users/me/calendarList. */
  calendars: FakeGoogleCalendar[];
  /** Scripted events.list batches, keyed by calendarId. */
  events: Map<string, FakeGoogleEventBatch[]>;
  /** calendarIds whose next events.list returns a 500. */
  failEvents: Set<string>;
  setCalendars(list: FakeGoogleCalendar[]): void;
  setEvents(calendarId: string, batches: FakeGoogleEventBatch[]): void;
  // --- tasks ---
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
}

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
  /**
   * A tombstone. Delivered ONLY when the request passes `showDeleted=true`
   * (Google's default is false) — the provider never asks, so its `t.deleted`
   * skip is belt-and-braces for a list that carries one anyway.
   */
  deleted?: boolean;
  hidden?: boolean;
}

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
    calendars: [],
    events: new Map(),
    failEvents: new Set(),
    setCalendars(list) { state.calendars = list; },
    setEvents(calendarId, batches) { state.events.set(calendarId, batches); },
    // --- tasks ---
    taskLists: [],
    tasks: new Map(),
    failTasks: new Set(),
    tasksPageSize: 100,
    createdTaskCount: 0,
    setTaskLists(lists) { state.taskLists = lists; },
    setTasks(listId, tasks) { state.tasks.set(listId, tasks); },
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

  // Userinfo — the account label. Routed by pathname, so this matches the
  // canonical https://openidconnect.googleapis.com/v1/userinfo.
  state.app.get('/v1/userinfo', (c) => {
    state.calls.push({ method: 'GET', path: '/v1/userinfo' });
    return c.json({ sub: 'google-user-id', email: state.userEmail, email_verified: true });
  });

  // --- calendar ---

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
    //
    // pageToken WINS over syncToken. On an incremental pull Google's follow-up
    // pages repeat the original query — syncToken included — and add pageToken,
    // so a fake that preferred syncToken would serve page 0 over and over until
    // the provider's MAX_PAGES guard tripped, and the paging test would pass
    // against a broken provider.
    const token = c.req.query('pageToken') ?? c.req.query('syncToken');
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
    // Honour showDeleted the way Google does (it defaults to FALSE): a
    // cancelled event is only delivered when it is asked for. A fake that
    // always returned them would let a provider that forgot the flag pass the
    // deletion test while silently never seeing a deletion in production.
    const showDeleted = c.req.query('showDeleted') === 'true';
    const visible = (page.events ?? []).filter((e) => showDeleted || e.status !== 'cancelled');
    const items = visible.map((e) => ({
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

  // --- tasks ---

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
    // `showDeleted` defaults to FALSE at Google, so a tombstoned task is not
    // even delivered unless asked for. The provider deliberately does not ask —
    // it detects deletions structurally by absence — so this filter is what
    // keeps the fake honest about that.
    const showDeleted = c.req.query('showDeleted') === 'true';
    // Honour the flags the way Google does, INCLUDING the defaults
    // (`showCompleted` defaults to true, `showHidden` to false) — a provider
    // that forgets showHidden must SEE completed tasks vanish.
    const showCompleted = (c.req.query('showCompleted') ?? 'true') === 'true';
    const showHidden = c.req.query('showHidden') === 'true';
    const visible = all.filter((t) => {
      if (t.deleted && !showDeleted) return false;
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

  return state;
}

/** Build a GoogleRuntime whose clients talk to the in-process fake over its fetch. */
export function runtimeForFakeGoogle(fake: FakeGoogle): GoogleRuntime {
  const fakeFetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    fake.app.request(input as string, init)) as typeof fetch;
  return createGoogleRuntime(TEST_CONFIG, fakeFetch);
}

export { TEST_CONFIG as fakeGoogleConfig };

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { seedTestHousehold, authHeaders } from './helpers.js';
import { createApp } from '../src/app.js';
import { householdModule } from '../src/household/index.js';
import { calendarModule } from '../src/modules/calendar/index.js';
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

const app = createApp([householdModule, calendarModule]);

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

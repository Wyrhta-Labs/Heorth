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

  it('rejects a body with no calendars key, and the existing allowlist survives', async () => {
    const { adult } = await seedTestHousehold();
    registerFakeCalendarProvider('google', fakeCalendarProvider('google', [{ id: 'cal-a', name: 'Anna' }]));
    await app.request('/api/v1/calendar/allowlist', {
      method: 'PUT', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ calendars: [{ provider: 'google', calendarId: 'cal-a' }] }),
    });

    // `calendars` is required (not defaulted) precisely so a body missing it
    // entirely (a stale cached bundle, an old tab) is rejected loudly instead
    // of being silently read as an empty selection that would wipe the row
    // above — and, for calendars, the feed's mirrored events with it.
    const res = await app.request('/api/v1/calendar/allowlist', {
      method: 'PUT', headers: authHeaders(adult.jwt),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);

    const check = await app.request('/api/v1/calendar/calendars', { headers: authHeaders(adult.jwt) });
    const { data } = await check.json() as { data: Array<{ id: string; enabled: boolean }> };
    expect(data.find((c) => c.id === 'cal-a')?.enabled).toBe(true);
  });

  it('an explicit empty calendars submission still de-selects everything', async () => {
    const { adult } = await seedTestHousehold();
    registerFakeCalendarProvider('google', fakeCalendarProvider('google', [{ id: 'cal-a', name: 'Anna' }]));
    await app.request('/api/v1/calendar/allowlist', {
      method: 'PUT', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ calendars: [{ provider: 'google', calendarId: 'cal-a' }] }),
    });

    const res = await app.request('/api/v1/calendar/allowlist', {
      method: 'PUT', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ calendars: [] }),
    });
    expect(res.status).toBe(200);

    const check = await app.request('/api/v1/calendar/calendars', { headers: authHeaders(adult.jwt) });
    const { data } = await check.json() as { data: Array<{ id: string; enabled: boolean }> };
    expect(data.find((c) => c.id === 'cal-a')?.enabled).toBe(false);
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

  it('refuses to de-select the household calendar via the allowlist route, and it survives', async () => {
    const { adult } = await seedTestHousehold();
    registerFakeCalendarProvider('google', fakeCalendarProvider('google', [
      { id: 'cal-a', name: 'Anna' }, { id: 'cal-b', name: 'Sport' },
    ]));
    await app.request('/api/v1/calendar/allowlist', {
      method: 'PUT', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ calendars: [
        { provider: 'google', calendarId: 'cal-a' }, { provider: 'google', calendarId: 'cal-b' },
      ] }),
    });
    await app.request('/api/v1/calendar/household-calendar', {
      method: 'PUT', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ provider: 'google', calendarId: 'cal-a' }),
    });

    // Submitting a selection that omits cal-a (the household calendar) must be
    // refused, not silently honored — designating it needs admin/adult, so
    // un-designating it must too.
    const res = await app.request('/api/v1/calendar/allowlist', {
      method: 'PUT', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ calendars: [{ provider: 'google', calendarId: 'cal-b' }] }),
    });
    expect(res.status).toBe(409);
    expect((await res.json() as { error: { code: string } }).error.code).toBe('HOUSEHOLD_CALENDAR_IN_USE');

    const check = await app.request('/api/v1/calendar/calendars', { headers: authHeaders(adult.jwt) });
    const { data } = await check.json() as { data: Array<{ id: string; enabled: boolean; isHousehold: boolean }> };
    const calA = data.find((c) => c.id === 'cal-a');
    expect(calA?.enabled).toBe(true);
    expect(calA?.isHousehold).toBe(true);
  });
});

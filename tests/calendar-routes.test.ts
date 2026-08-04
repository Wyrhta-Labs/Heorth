import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app.js';
import { householdModule } from '../src/household/index.js';
import { calendarModule } from '../src/modules/calendar/index.js';
import { seedTestHousehold, authHeaders } from './helpers.js';

const app = createApp([householdModule, calendarModule]);

async function makeEvent(jwt: string, title = 'Event') {
  const res = await app.request('/api/v1/events', {
    method: 'POST', headers: authHeaders(jwt),
    body: JSON.stringify({ title, startAt: '2026-07-10T09:00:00Z', endAt: '2026-07-10T10:00:00Z' }),
  });
  return res;
}

describe('calendar routes', () => {
  it('creates and lists events in a range', async () => {
    const { adult } = await seedTestHousehold();
    await makeEvent(adult.jwt);
    const list = await app.request('/api/v1/events?from=2026-07-01T00:00:00Z&to=2026-07-31T00:00:00Z', {
      headers: authHeaders(adult.jwt),
    });
    expect(list.status).toBe(200);
    const body = await list.json() as { data: unknown[] };
    expect(body.data.length).toBe(1);
  });

  it('lets a child edit their own event but not another member event', async () => {
    const { adult, child } = await seedTestHousehold();
    const childEventRes = await makeEvent(child.jwt, 'Kid practice');
    const { data: childEvent } = await childEventRes.json() as { data: { id: string } };
    const adultEventRes = await makeEvent(adult.jwt, 'Bills');
    const { data: adultEvent } = await adultEventRes.json() as { data: { id: string } };

    const own = await app.request(`/api/v1/events/${childEvent.id}`, {
      method: 'PATCH', headers: authHeaders(child.jwt), body: JSON.stringify({ title: 'Renamed' }),
    });
    expect(own.status).toBe(200);

    const other = await app.request(`/api/v1/events/${adultEvent.id}`, {
      method: 'PATCH', headers: authHeaders(child.jwt), body: JSON.stringify({ title: 'Nope' }),
    });
    expect(other.status).toBe(403);
  });

  it('moves an event', async () => {
    const { adult } = await seedTestHousehold();
    const { data } = await (await makeEvent(adult.jwt)).json() as { data: { id: string } };
    const moved = await app.request(`/api/v1/events/${data.id}/move`, {
      method: 'POST', headers: authHeaders(adult.jwt), body: JSON.stringify({ startAt: '2026-07-11T14:00:00Z' }),
    });
    expect(moved.status).toBe(200);
  });
});

describe('maintenance admin quarantine', () => {
  it('refuses to create an event with the admin as creator', async () => {
    const { admin } = await seedTestHousehold();
    const res = await app.request('/api/v1/events', {
      method: 'POST', headers: authHeaders(admin.jwt),
      body: JSON.stringify({
        title: 'Admin event',
        startAt: '2026-08-04T10:00:00Z', endAt: '2026-08-04T11:00:00Z',
      }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('ADMIN_NOT_A_MEMBER');
  });

  it('refuses to add the admin as an attendee', async () => {
    const { admin, adult } = await seedTestHousehold();
    const res = await app.request('/api/v1/events', {
      method: 'POST', headers: authHeaders(adult.jwt),
      body: JSON.stringify({
        title: 'Family dinner',
        startAt: '2026-08-04T10:00:00Z', endAt: '2026-08-04T11:00:00Z',
        attendeeIds: [adult.user.id, admin.user.id],
      }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('ADMIN_NOT_A_MEMBER');
  });

  it('refuses to patch the admin onto an existing event', async () => {
    const { admin, adult } = await seedTestHousehold();
    const created = await app.request('/api/v1/events', {
      method: 'POST', headers: authHeaders(adult.jwt),
      body: JSON.stringify({
        title: 'Family dinner',
        startAt: '2026-08-04T10:00:00Z', endAt: '2026-08-04T11:00:00Z',
        attendeeIds: [adult.user.id],
      }),
    });
    const { data } = await created.json();

    const res = await app.request(`/api/v1/events/${data.id}`, {
      method: 'PATCH', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ attendeeIds: [admin.user.id] }),
    });
    expect(res.status).toBe(403);
  });

  it('still lets an ordinary member create an event', async () => {
    const { adult } = await seedTestHousehold();
    const res = await app.request('/api/v1/events', {
      method: 'POST', headers: authHeaders(adult.jwt),
      body: JSON.stringify({
        title: 'Adult event',
        startAt: '2026-08-04T10:00:00Z', endAt: '2026-08-04T11:00:00Z',
        attendeeIds: [adult.user.id],
      }),
    });
    expect(res.status).toBe(201);
  });
});

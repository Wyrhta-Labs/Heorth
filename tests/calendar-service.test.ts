import { describe, it, expect } from 'vitest';
import { seedTestHousehold } from './helpers.js';
import * as service from '../src/modules/calendar/service.js';

describe('calendar service', () => {
  it('creates an event with attendees and reads them back', async () => {
    const { adult, child } = await seedTestHousehold();
    const created = await service.createEvent({
      title: 'Dentist', startAt: '2026-07-10T09:00:00Z', endAt: '2026-07-10T09:30:00Z',
      allDay: false, attendeeIds: [child.user.id],
    } as never, adult.user.id);
    expect(created!.attendeeIds).toEqual([child.user.id]);
  });

  it('expands a recurring event within a range and filters by member', async () => {
    const { child, adult } = await seedTestHousehold();
    await service.createEvent({
      title: 'Bins out', startAt: '2026-07-01T18:00:00Z', endAt: '2026-07-01T18:30:00Z',
      allDay: false, recurrence: 'P1W', attendeeIds: [adult.user.id],
    } as never, child.user.id);

    const all = await service.listEvents({ from: '2026-07-01T00:00:00Z', to: '2026-07-31T23:59:59Z' });
    expect(all.rows.length).toBe(5);

    const mine = await service.listEvents({
      from: '2026-07-01T00:00:00Z', to: '2026-07-31T23:59:59Z', member_id: adult.user.id,
    });
    expect(mine.rows.length).toBe(5);
  });

  it('bounds the EXPANDED OCCURRENCES with limit, not the underlying event rows', async () => {
    const { adult } = await seedTestHousehold();
    // ONE event row that expands into five weekly occurrences in July.
    await service.createEvent({
      title: 'Bins out', startAt: '2026-07-01T18:00:00Z', endAt: '2026-07-01T18:30:00Z',
      allDay: false, recurrence: 'P1W',
    } as never, adult.user.id);

    const range = { from: '2026-07-01T00:00:00Z', to: '2026-07-31T23:59:59Z' };
    const all = await service.listEvents(range);
    expect(all.rows.length).toBe(5);

    const bounded = await service.listEvents({ ...range, limit: 2 });
    expect(bounded.rows.length).toBe(2);
    expect(bounded.total).toBe(5);
    expect(bounded.limit).toBe(2);
    expect(bounded.offset).toBe(0);
    expect(bounded.rows.map((r) => (r as { occurrenceStart: string }).occurrenceStart))
      .toEqual(all.rows.slice(0, 2).map((r) => (r as { occurrenceStart: string }).occurrenceStart));
  });

  it('offsets into the expanded occurrences and keeps chronological order', async () => {
    const { adult } = await seedTestHousehold();
    await service.createEvent({
      title: 'Bins out', startAt: '2026-07-01T18:00:00Z', endAt: '2026-07-01T18:30:00Z',
      allDay: false, recurrence: 'P1W',
    } as never, adult.user.id);

    const range = { from: '2026-07-01T00:00:00Z', to: '2026-07-31T23:59:59Z' };
    const all = await service.listEvents(range);
    const page = await service.listEvents({ ...range, limit: 2, offset: 2 });
    expect(page.rows.length).toBe(2);
    expect(page.total).toBe(5);
    expect(page.offset).toBe(2);
    expect(page.rows.map((r) => (r as { occurrenceStart: string }).occurrenceStart))
      .toEqual(all.rows.slice(2, 4).map((r) => (r as { occurrenceStart: string }).occurrenceStart));
  });

  it('combines the member filter with a bound over occurrences', async () => {
    const { adult, child } = await seedTestHousehold();
    await service.createEvent({
      title: 'Bins out', startAt: '2026-07-01T18:00:00Z', endAt: '2026-07-01T18:30:00Z',
      allDay: false, recurrence: 'P1W', attendeeIds: [adult.user.id],
    } as never, child.user.id);
    await service.createEvent({
      title: 'Kid practice', startAt: '2026-07-02T16:00:00Z', endAt: '2026-07-02T17:00:00Z',
      allDay: false,
    } as never, child.user.id);

    const range = { from: '2026-07-01T00:00:00Z', to: '2026-07-31T23:59:59Z' };
    const mine = await service.listEvents({ ...range, member_id: adult.user.id });
    expect(mine.rows.length).toBe(5); // the kid-only event is filtered out

    const bounded = await service.listEvents({ ...range, member_id: adult.user.id, limit: 3 });
    expect(bounded.rows.length).toBe(3);
    expect(bounded.total).toBe(5);
  });

  it('listUpcoming is the same bounded range query (limit over occurrences)', async () => {
    const { adult } = await seedTestHousehold();
    const soon = new Date(Date.now() + 1000 * 60 * 60 * 24); // tomorrow
    await service.createEvent({
      title: 'Standup', startAt: soon.toISOString(),
      endAt: new Date(soon.getTime() + 1000 * 60 * 30).toISOString(),
      allDay: false, recurrence: 'P1D',
    } as never, adult.user.id);

    const upcoming = await service.listUpcoming(null, 3);
    expect(upcoming.length).toBe(3);
    const starts = upcoming.map((o) => o.occurrenceStart);
    expect([...starts].sort()).toEqual(starts);

    // The same result expressed purely as a REST-shaped range query.
    const now = new Date();
    const horizon = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 90);
    const viaRange = await service.listEvents({
      from: now.toISOString(), to: horizon.toISOString(), limit: 3,
    });
    expect(viaRange.rows.map((r) => (r as { occurrenceStart: string }).occurrenceStart)).toEqual(starts);
  });

  it('moves an event, preserving duration when endAt omitted', async () => {
    const { adult } = await seedTestHousehold();
    const created = await service.createEvent({
      title: 'Call', startAt: '2026-07-10T09:00:00Z', endAt: '2026-07-10T10:00:00Z', allDay: false,
    } as never, adult.user.id);
    const moved = await service.moveEvent(created!.id, '2026-07-11T14:00:00Z');
    expect(moved!.startAt.toISOString()).toBe('2026-07-11T14:00:00.000Z');
    expect(moved!.endAt.toISOString()).toBe('2026-07-11T15:00:00.000Z');
  });
});

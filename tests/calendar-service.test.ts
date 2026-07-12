import { describe, it, expect } from 'vitest';
import { seedTestHousehold } from './helpers.js';
import * as service from '../src/modules/calendar/service.js';

describe('calendar service', () => {
  it('creates an event with attendees and reads them back', async () => {
    const { admin, child } = await seedTestHousehold();
    const created = await service.createEvent({
      title: 'Dentist', startAt: '2026-07-10T09:00:00Z', endAt: '2026-07-10T09:30:00Z',
      allDay: false, attendeeIds: [child.user.id],
    } as never, admin.user.id);
    expect(created!.attendeeIds).toEqual([child.user.id]);
  });

  it('expands a recurring event within a range and filters by member', async () => {
    const { admin, adult } = await seedTestHousehold();
    await service.createEvent({
      title: 'Bins out', startAt: '2026-07-01T18:00:00Z', endAt: '2026-07-01T18:30:00Z',
      allDay: false, recurrence: 'P1W', attendeeIds: [adult.user.id],
    } as never, admin.user.id);

    const all = await service.listEvents({ from: '2026-07-01T00:00:00Z', to: '2026-07-31T23:59:59Z' });
    expect(all.rows.length).toBe(5);

    const mine = await service.listEvents({
      from: '2026-07-01T00:00:00Z', to: '2026-07-31T23:59:59Z', member_id: adult.user.id,
    });
    expect(mine.rows.length).toBe(5);
  });

  it('moves an event, preserving duration when endAt omitted', async () => {
    const { admin } = await seedTestHousehold();
    const created = await service.createEvent({
      title: 'Call', startAt: '2026-07-10T09:00:00Z', endAt: '2026-07-10T10:00:00Z', allDay: false,
    } as never, admin.user.id);
    const moved = await service.moveEvent(created!.id, '2026-07-11T14:00:00Z');
    expect(moved!.startAt.toISOString()).toBe('2026-07-11T14:00:00.000Z');
    expect(moved!.endAt.toISOString()).toBe('2026-07-11T15:00:00.000Z');
  });
});

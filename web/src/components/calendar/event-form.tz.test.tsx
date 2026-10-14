// The browser sits in Los Angeles, the household in Auckland (UTC+12 in July,
// 19 hours ahead): the form's times are the HOUSEHOLD's wall clock.
process.env.TZ = 'America/Los_Angeles';

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Event } from '@/lib/types';

vi.mock('@/hooks/use-household', () => ({
  useHousehold: () => ({ data: { data: { timezone: 'Pacific/Auckland' } } }),
  useHouseholdMembers: () => ({ data: { data: [] } }),
}));

import EventForm from './event-form';

afterEach(() => { cleanup(); vi.useRealTimers(); });

const submitWith = async (props: Partial<Parameters<typeof EventForm>[0]> = {}) => {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  const user = userEvent.setup();
  render(<EventForm onSubmit={onSubmit} onCancel={() => {}} {...props} />);
  return { onSubmit, user };
};

describe('EventForm in the household time zone', () => {
  it('saves 09:00 on a household day as 09:00 household time', async () => {
    const { onSubmit, user } = await submitWith({ initialDate: '2026-08-03' });
    expect(screen.getByLabelText('Start *')).toHaveValue('2026-08-03T09:00');
    await user.type(screen.getByLabelText('Title *'), 'School run');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    // 09:00 NZST on Mon 3 Aug is 21:00Z on Sun 2 Aug.
    expect(onSubmit.mock.calls[0][0].startAt).toBe('2026-08-02T21:00:00.000Z');
    expect(onSubmit.mock.calls[0][0].endAt).toBe('2026-08-02T22:00:00.000Z');
  });

  it("defaults to the next household hour on the household's today", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 22:30Z Sun 26 Jul: 10:30 Mon 27 Jul in Auckland, 15:30 Sun in Los Angeles.
    vi.setSystemTime(new Date('2026-07-26T22:30:00Z'));
    await submitWith({ initialDate: '2026-07-27' });
    expect(screen.getByLabelText('Start *')).toHaveValue('2026-07-27T11:00');
    expect(screen.getByLabelText('End *')).toHaveValue('2026-07-27T12:00');
  });

  it("shows an existing event's times on the household clock", async () => {
    const event = {
      id: 'e1', title: 'Trip', startAt: '2026-07-26T21:00:00.000Z', endAt: '2026-07-26T22:30:00.000Z',
      allDay: false, location: null, notes: null, category: null, color: null,
      createdBy: 'm1', recurrence: null, attendeeIds: [], createdAt: '', updatedAt: '',
    } as Event;
    const { onSubmit, user } = await submitWith({ event });
    expect(screen.getByLabelText('Start *')).toHaveValue('2026-07-27T09:00');
    expect(screen.getByLabelText('End *')).toHaveValue('2026-07-27T10:30');
    // ...and an unchanged save round-trips to the same instants.
    await user.click(screen.getByRole('button', { name: 'Update' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].startAt).toBe(event.startAt);
    expect(onSubmit.mock.calls[0][0].endAt).toBe(event.endAt);
  });
});

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Event } from '@/lib/types';

// EventForm reads the household roster via useMembers; stub it with two members.
const members = [
  { id: 'm1', email: 'a@t', handle: 'ada', role: 'adult', displayName: 'Ada', avatarColor: 'ember', createdAt: '', updatedAt: '' },
  { id: 'm2', email: 'b@t', handle: 'ben', role: 'child', displayName: 'Ben', avatarColor: 'sky', createdAt: '', updatedAt: '' },
];
vi.mock('@/hooks/use-household', () => ({
  useMembers: () => ({ data: { data: members } }),
}));

import EventForm from './event-form';

describe('EventForm attendee round-trip', () => {
  it('submits the attendee ids toggled on in the roster', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<EventForm onSubmit={onSubmit} onCancel={() => {}} />);

    await user.type(screen.getByLabelText('Title *'), 'Dentist');
    await user.type(screen.getByLabelText('Start *'), '2026-07-05T09:00');
    await user.type(screen.getByLabelText('End *'), '2026-07-05T10:00');
    await user.click(screen.getByRole('button', { name: /Ada/ }));

    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].attendeeIds).toEqual(['m1']);
    expect(onSubmit.mock.calls[0][0].title).toBe('Dentist');
  });

  it('pre-selects an existing event’s attendees and preserves them on submit', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    const event = {
      id: 'e1', title: 'Trip', startAt: '2026-07-05T09:00:00.000Z', endAt: '2026-07-05T10:00:00.000Z',
      allDay: false, location: null, notes: null, category: null, color: null,
      recurrence: null, attendeeIds: ['m2'], createdBy: 'm1', createdAt: '', updatedAt: '',
    } as unknown as Event;
    render(<EventForm event={event} onSubmit={onSubmit} onCancel={() => {}} />);

    // Ben (m2) starts selected; toggling Ada (m1) adds it without dropping Ben.
    await user.click(screen.getByRole('button', { name: /Ada/ }));
    await user.click(screen.getByRole('button', { name: 'Update' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].attendeeIds.sort()).toEqual(['m1', 'm2']);
  });
});

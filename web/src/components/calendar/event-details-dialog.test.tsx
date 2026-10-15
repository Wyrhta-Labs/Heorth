import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { EventOccurrence } from '@/lib/types';

vi.mock('@/hooks/use-household', () => ({
  useHousehold: () => ({ data: { data: { timezone: 'UTC' } }, isError: false }),
  useHouseholdMembers: () => ({ data: { data: [{ id: 'm1', displayName: 'Ada' }, { id: 'm2', displayName: 'Ben' }] } }),
}));
const occurrences = vi.fn(() => [] as EventOccurrence[]);
vi.mock('@/hooks/use-calendar', () => ({
  useEvents: () => ({ data: { data: occurrences() }, isLoading: false, isError: false, refetch: vi.fn() }),
}));

import Agenda from '@/components/dashboard/agenda';

const event = (over: Partial<EventOccurrence> = {}): EventOccurrence => ({
  id: 'e1', createdAt: '', updatedAt: '', title: 'Parents evening',
  // A weekly series that started a week earlier; this is the 15 Oct occurrence.
  startAt: '2026-10-08T17:00:00Z', endAt: '2026-10-08T18:30:00Z', occurrenceStart: '2026-10-15T17:00:00Z',
  allDay: false, location: 'School hall', notes: 'Bring the reading log.\nAsk about trips.', category: null, color: null,
  createdBy: 'm1', recurrence: 'P1W', attendeeIds: ['m1', 'm2'], ...over,
});

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('Agenda event details', () => {
  it('opens a modal with the occurrence details on click and closes it again', () => {
    occurrences.mockReturnValue([event()]);
    render(<Agenda />);
    fireEvent.click(screen.getByRole('button', { name: /parents evening/i }));

    const dialog = screen.getByRole('dialog', { name: 'Parents evening' });
    expect(dialog).toHaveTextContent('Oct 15, 2026');
    expect(dialog).toHaveTextContent('5:00 PM – 6:30 PM');
    expect(dialog).toHaveTextContent('School hall');
    expect(dialog).toHaveTextContent('Weekly');
    expect(dialog).toHaveTextContent('Ada, Ben');
    expect(dialog).toHaveTextContent('Ask about trips.');

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('marks a mirrored event with its source', () => {
    occurrences.mockReturnValue([event({ source: 'm365', organizer: 'Coach', recurrence: null, notes: null })]);
    render(<Agenda />);
    fireEvent.click(screen.getByRole('button', { name: /parents evening/i }));
    expect(screen.getByRole('dialog')).toHaveTextContent('From Microsoft 365 · Coach (read-only)');
  });
});

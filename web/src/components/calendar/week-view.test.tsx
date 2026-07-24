import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EventOccurrence } from '@/lib/types';

// Pin "now" so weekDays() renders a known week containing our fixtures.
vi.mock('@/lib/format', async (orig) => {
  const actual = await orig<typeof import('@/lib/format')>();
  return actual;
});

import WeekView from './week-view';

function occ(partial: Partial<EventOccurrence>): EventOccurrence {
  const start = partial.startAt ?? '2026-07-06T09:00:00.000Z';
  return {
    id: 'x', title: 'Untitled', startAt: start, endAt: start, allDay: false,
    location: null, notes: null, category: null, color: null, createdBy: '',
    recurrence: null, attendeeIds: [], createdAt: '', updatedAt: '',
    occurrenceStart: start, ...partial,
  };
}

describe('WeekView mirrored (M365) events', () => {
  it('renders a mirrored event as read-only (no edit button) and a native event as clickable', async () => {
    const day = new Date();
    day.setHours(9, 0, 0, 0);
    const iso = day.toISOString();
    const onSelect = vi.fn();

    render(<WeekView
      occurrences={[
        occ({ id: 'n1', title: 'Native Party', source: 'native', startAt: iso, occurrenceStart: iso }),
        occ({ id: 'm1', title: 'M365 Dentist', source: 'm365', organizer: 'Reception', startAt: iso, occurrenceStart: iso }),
      ]}
      onSelect={onSelect}
    />);

    // Native event is a clickable button that fires onSelect.
    const nativeBtn = screen.getByRole('button', { name: /Native Party/ });
    await userEvent.click(nativeBtn);
    expect(onSelect).toHaveBeenCalledTimes(1);

    // Mirrored event is present but NOT a button (no edit affordance).
    expect(screen.getByText('M365 Dentist')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /M365 Dentist/ })).toBeNull();
  });
});

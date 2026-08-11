import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import HearthMonth from './hearth-month';
import type { EventOccurrence, Member, Recipe } from '@/lib/types';

afterEach(cleanup);

function occurrence(overrides: Partial<EventOccurrence>): EventOccurrence {
  return {
    id: 'e1', createdAt: '', updatedAt: '', title: 'Event', startAt: '2026-07-20T08:00:00',
    endAt: '2026-07-20T09:00:00', allDay: false, location: null, notes: null, category: null,
    color: null, createdBy: 'nobody', recurrence: null, attendeeIds: [],
    occurrenceStart: '2026-07-20T08:00:00',
    ...overrides,
  };
}

const base = {
  year: 2026,
  month0: 6, // July
  todayIso: '2026-07-20',
  entries: [],
  tasks: [],
  membersById: {} as Record<string, Member>,
  recipesById: {} as Record<string, Recipe>,
  staleByOwner: {},
};

describe('HearthMonth all-day events', () => {
  it('renders an all-day event as a filled pill and a timed event as dot + title', () => {
    const occurrences = [
      occurrence({ id: 'ad', title: 'School holidays', allDay: true, occurrenceStart: '2026-07-20T00:00:00' }),
      occurrence({ id: 'tm', title: 'Dentist', occurrenceStart: '2026-07-20T08:00:00' }),
    ];
    const { container } = render(<HearthMonth {...base} occurrences={occurrences} />);

    // All-day: identifiable via the tinted pill (title on a fill of the
    // attribution colour), no leading dot.
    const pill = container.querySelector('[data-allday]');
    expect(pill).toBeInTheDocument();
    expect(pill).toHaveTextContent('School holidays');
    expect((pill as HTMLElement).style.backgroundColor).not.toBe('');
    expect(pill!.querySelector('span')).toBeNull(); // no dot inside the pill

    // Timed: keeps the coloured dot + plain title row, no pill marker.
    const timedTitle = screen.getByText('Dentist');
    const timedRow = timedTitle.closest('div')!;
    expect(timedRow.hasAttribute('data-allday')).toBe(false);
    expect(timedRow.querySelector('span[aria-hidden]')).toBeInTheDocument(); // the dot
  });

  it('keeps the max-3 + "+N more" collapse across mixed all-day and timed events', () => {
    const occurrences = [
      occurrence({ id: 'a', title: 'Holiday A', allDay: true, occurrenceStart: '2026-07-20T00:00:00' }),
      occurrence({ id: 'b', title: 'Meeting B', occurrenceStart: '2026-07-20T08:00:00' }),
      occurrence({ id: 'c', title: 'Meeting C', occurrenceStart: '2026-07-20T09:00:00' }),
      occurrence({ id: 'd', title: 'Meeting D', occurrenceStart: '2026-07-20T10:00:00' }),
      occurrence({ id: 'e', title: 'Meeting E', occurrenceStart: '2026-07-20T11:00:00' }),
    ];
    render(<HearthMonth {...base} occurrences={occurrences} />);

    // All-day sorts first (lib/hearth.ts eventsForDay), then the first two timed.
    expect(screen.getByText('Holiday A')).toBeInTheDocument();
    expect(screen.getByText('Meeting B')).toBeInTheDocument();
    expect(screen.getByText('Meeting C')).toBeInTheDocument();
    expect(screen.queryByText('Meeting D')).toBeNull();
    expect(screen.getByText('+2 more')).toBeInTheDocument();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const refetch = vi.fn();
let queryState: any = { data: undefined, isLoading: false, isError: false, refetch };
let lastParams: unknown;
vi.mock('@/hooks/use-calendar', () => ({ useEvents: (p: unknown) => { lastParams = p; return queryState; } }));

import Agenda from './agenda';
import { dayRangeIso } from '@/lib/format';

describe('Agenda error handling', () => {
  beforeEach(() => { refetch.mockClear(); });

  it('renders an error surface with retry (not empty) when the query errors', async () => {
    queryState = { data: undefined, isLoading: false, isError: true, refetch };
    const user = userEvent.setup();
    render(<Agenda />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('No events today.')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('shows the normal empty state when the query succeeds with no events', () => {
    queryState = { data: { data: [] }, isLoading: false, isError: false, refetch };
    render(<Agenda />);
    expect(screen.getByText('No events today.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('Agenda for another day', () => {
  it('queries the given day and shows the caller’s empty message', () => {
    queryState = { data: { data: [] }, isLoading: false, isError: false, refetch };
    render(<Agenda day={new Date(2026, 9, 5)} emptyMessage="Nothing tomorrow." />);
    expect(screen.getByText('Nothing tomorrow.')).toBeInTheDocument();
    expect(lastParams).toEqual(dayRangeIso(new Date(2026, 9, 5)));
  });
});

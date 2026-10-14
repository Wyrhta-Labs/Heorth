import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const refetch = vi.fn();
let queryState: any = { data: undefined, isLoading: false, isError: false, refetch };
let lastParams: unknown;
vi.mock('@/hooks/use-household', () => ({ useHousehold: () => ({ data: { data: { timezone: 'UTC' } }, isError: false }) }));
vi.mock('@/hooks/use-calendar', () => ({ useEvents: (p: unknown) => { lastParams = p; return queryState; } }));

import Agenda from './agenda';

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
  it('queries the household day `offset` days on and shows the caller’s empty message', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-04T12:00:00Z'));
    queryState = { data: { data: [] }, isLoading: false, isError: false, refetch };
    render(<Agenda offset={1} emptyMessage="Nothing tomorrow." />);
    expect(screen.getByText('Nothing tomorrow.')).toBeInTheDocument();
    expect(lastParams).toEqual({ from: '2026-10-05T00:00:00.000Z', to: '2026-10-05T23:59:59.999Z' });
    vi.useRealTimers();
  });
});

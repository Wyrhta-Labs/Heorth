import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const okList = { data: { data: [] }, isError: false, isLoading: false, refetch: vi.fn() };
const mutation = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };

vi.mock('@/hooks/use-calendar', () => ({
  useEvents: () => okList,
  useCreateEvent: () => mutation,
  useUpdateEvent: () => mutation,
  useDeleteEvent: () => mutation,
}));
vi.mock('@/hooks/use-household', () => ({
  useHousehold: () => ({ data: { data: { timezone: 'Europe/Berlin' } }, isError: false }),
  useHouseholdMembers: () => ({ data: { data: [] } }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/calendar/week-view', () => ({ default: () => <div>week-grid</div> }));
vi.mock('@/components/calendar/month-view', () => ({ default: () => <div>month-grid</div> }));

import CalendarPage from './calendar';

beforeEach(() => {
  localStorage.clear();
});

describe('CalendarPage view memory', () => {
  it('reopens in the view last chosen in this browser', () => {
    const first = render(<CalendarPage />);
    expect(screen.getByText('week-grid')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^month$/i }));
    first.unmount();

    render(<CalendarPage />);
    expect(screen.getByText('month-grid')).toBeInTheDocument();
  });
});

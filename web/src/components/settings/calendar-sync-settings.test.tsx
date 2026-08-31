import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/api/calendar-allowlist', () => ({
  listCalendars: vi.fn(),
  setCalendarAllowlist: vi.fn(),
  setHouseholdCalendar: vi.fn(),
}));

import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { listCalendars, setCalendarAllowlist, setHouseholdCalendar } from '@/api/calendar-allowlist';
import { CalendarSyncSettings } from './calendar-sync-settings';

/**
 * Local wrapper — the repo has no shared one. Retry off so a rejected query
 * fails the test immediately instead of hanging on backoff.
 *
 * Uses RTL's `wrapper` option rather than wrapping the element inline: the
 * `rerender` RTL returns re-renders the ELEMENT it is given, so an inline
 * wrapper is dropped on rerender and every React Query hook underneath throws
 * "No QueryClient set". The `wrapper` option survives rerenders.
 */
function renderWithProviders(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(ui, {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    ),
  });
}

const mocked = (fn: unknown) => fn as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mocked(setCalendarAllowlist).mockResolvedValue({ data: [] });
  mocked(setHouseholdCalendar).mockResolvedValue({ data: null });
});

describe('CalendarSyncSettings', () => {
  it('groups calendars by provider and shows which are synced', async () => {
    mocked(listCalendars).mockResolvedValue({ data: [
      { provider: 'google', id: 'cal-a', name: 'Anna', enabled: true, isHousehold: false },
      { provider: 'google', id: 'cal-b', name: 'Sport', enabled: false, isHousehold: false },
    ] });

    renderWithProviders(<CalendarSyncSettings canDesignate />);

    expect(await screen.findByLabelText('Anna')).toBeChecked();
    expect(screen.getByLabelText('Sport')).not.toBeChecked();
  });

  it('submits the full desired selection, provider-tagged', async () => {
    mocked(listCalendars).mockResolvedValue({ data: [
      { provider: 'google', id: 'cal-a', name: 'Anna', enabled: true, isHousehold: false },
      { provider: 'google', id: 'cal-b', name: 'Sport', enabled: false, isHousehold: false },
    ] });

    renderWithProviders(<CalendarSyncSettings canDesignate />);
    await userEvent.click(await screen.findByLabelText('Sport'));

    await waitFor(() => expect(setCalendarAllowlist).toHaveBeenCalledWith([
      { provider: 'google', calendarId: 'cal-a' },
      { provider: 'google', calendarId: 'cal-b' },
    ]));
  });

  it('offers the household radio only for a synced calendar, and only to an adult', async () => {
    mocked(listCalendars).mockResolvedValue({ data: [
      { provider: 'google', id: 'cal-a', name: 'Anna', enabled: true, isHousehold: false },
      { provider: 'google', id: 'cal-b', name: 'Sport', enabled: false, isHousehold: false },
    ] });

    const { rerender } = renderWithProviders(<CalendarSyncSettings canDesignate />);
    await screen.findByLabelText('Anna');
    expect(screen.getAllByRole('radio')).toHaveLength(1);

    rerender(<CalendarSyncSettings canDesignate={false} />);
    await waitFor(() => expect(screen.queryAllByRole('radio')).toHaveLength(0));
  });

  it('designates the household calendar when the radio is picked', async () => {
    mocked(listCalendars).mockResolvedValue({ data: [
      { provider: 'google', id: 'cal-a', name: 'Anna', enabled: true, isHousehold: false },
    ] });

    renderWithProviders(<CalendarSyncSettings canDesignate />);
    await userEvent.click(await screen.findByRole('radio'));

    await waitFor(() => expect(setHouseholdCalendar).toHaveBeenCalledWith('google', 'cal-a'));
  });
});

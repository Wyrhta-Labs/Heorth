import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ProfilePage from './profile';

const toast = vi.fn();
const useWhoamiMock = vi.fn();
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/profile/provider-card', () => ({
  default: ({ provider }: { provider: { id: string } }) => <div>card:{provider.id}</div>,
}));

/**
 * Mocked by default (most tests here have no QueryClientProvider around
 * ProfilePage, and CalendarSyncSettings calls useQuery). One test below
 * flips `useRealCalendarSync` to true and wraps ITS render in a real
 * QueryClientProvider, proving the real component mounts inside the real
 * ProfilePage tree rather than only being proven by the build.
 */
let useRealCalendarSync = false;
vi.mock('@/components/settings/calendar-sync-settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/settings/calendar-sync-settings')>();
  return {
    CalendarSyncSettings: (props: { canDesignate: boolean }) =>
      useRealCalendarSync
        ? <actual.CalendarSyncSettings {...props} />
        : <div>calendar-sync-settings:{String(props.canDesignate)}</div>,
  };
});
vi.mock('@/api/calendar-allowlist', () => ({
  listCalendars: vi.fn(),
  setCalendarAllowlist: vi.fn(),
  setHouseholdCalendar: vi.fn(),
}));

vi.mock('@/hooks/use-household', () => ({ useWhoami: () => useWhoamiMock() }));

const ordinaryMember = { data: { data: { id: 'm1', handle: 'anna', role: 'adult', displayName: 'Anna' } } };
const maintenanceAdmin = { data: { data: { id: 'a1', handle: 'admin', role: 'admin', displayName: 'Admin' } } };

beforeEach(() => useWhoamiMock.mockReturnValue(ordinaryMember));
afterEach(() => { cleanup(); toast.mockClear(); useWhoamiMock.mockReset(); useRealCalendarSync = false; });

describe('ProfilePage', () => {
  it('renders a card per registered provider for an ordinary member', () => {
    render(<ProfilePage />);
    expect(screen.getByText('card:m365')).toBeInTheDocument();
    expect(screen.getByText('calendar-sync-settings:true')).toBeInTheDocument();
  });

  it('does not let a child designate the household calendar', () => {
    useWhoamiMock.mockReturnValue({ data: { data: { id: 'm3', handle: 'kid', role: 'child', displayName: 'Kid' } } });
    render(<ProfilePage />);
    expect(screen.getByText('calendar-sync-settings:false')).toBeInTheDocument();
  });

  it('mounts the real calendar picker under the connection cards', async () => {
    const { listCalendars } = await import('@/api/calendar-allowlist');
    vi.mocked(listCalendars).mockResolvedValue({ data: [
      { provider: 'google', id: 'cal-a', name: 'Anna', enabled: true, isHousehold: false },
    ] });
    useRealCalendarSync = true;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={qc}>
        <ProfilePage />
      </QueryClientProvider>,
    );

    expect(screen.getByText('card:m365')).toBeInTheDocument();
    expect(await screen.findByText('Synced calendars')).toBeInTheDocument();
    expect(await screen.findByLabelText('Anna')).toBeInTheDocument();
  });

  it('renders the maintenance-admin explanatory card instead of provider cards when the session is the maintenance admin', () => {
    useWhoamiMock.mockReturnValue(maintenanceAdmin);
    render(<ProfilePage />);
    expect(screen.queryByText('card:m365')).not.toBeInTheDocument();
    expect(screen.getByText('This is the maintenance account')).toBeInTheDocument();
  });

  it('does not render the maintenance-admin card for an ordinary member, even one with a promoted admin role', () => {
    // Regression: a promoted member (role: 'admin', handle != 'admin') must
    // still see the normal provider cards, not the maintenance explanation.
    useWhoamiMock.mockReturnValue({ data: { data: { id: 'm2', handle: 'anna', role: 'admin', displayName: 'Anna' } } });
    render(<ProfilePage />);
    expect(screen.getByText('card:m365')).toBeInTheDocument();
    expect(screen.queryByText('This is the maintenance account')).not.toBeInTheDocument();
  });

  it('turns ?connected=m365 into a success toast and clears the param', async () => {
    window.history.replaceState({}, '', '/profile?connected=m365');
    render(<ProfilePage />);
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.any(String), 'success'));
    expect(window.location.search).toBe('');
  });

  it('turns ?connectError= into an error toast and clears the param', async () => {
    window.history.replaceState({}, '', '/profile?connectError=M365_CONSENT_DENIED');
    render(<ProfilePage />);
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.any(String), 'error'));
    expect(window.location.search).toBe('');
  });

  it('maps ADMIN_NOT_A_MEMBER to its specific message', async () => {
    window.history.replaceState({}, '', '/profile?connectError=ADMIN_NOT_A_MEMBER');
    render(<ProfilePage />);
    await waitFor(() => expect(toast).toHaveBeenCalledWith(
      expect.stringContaining('maintenance admin'),
      'error',
    ));
  });

  it('maps GOOGLE_NO_REFRESH_TOKEN to its retry-specific message', async () => {
    window.history.replaceState({}, '', '/profile?connectError=GOOGLE_NO_REFRESH_TOKEN');
    render(<ProfilePage />);
    await waitFor(() => expect(toast).toHaveBeenCalledWith(
      expect.stringContaining('offline access'),
      'error',
    ));
  });

  it('falls back to the generic message for an unrecognised error code', async () => {
    window.history.replaceState({}, '', '/profile?connectError=SOMETHING_UNKNOWN');
    render(<ProfilePage />);
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.any(String), 'error'));
  });

  it('does not toast on a plain visit', async () => {
    window.history.replaceState({}, '', '/profile');
    render(<ProfilePage />);
    await waitFor(() => expect(toast).not.toHaveBeenCalled());
  });
});

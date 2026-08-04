import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import ProfilePage from './profile';

const toast = vi.fn();
const useWhoamiMock = vi.fn();
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/profile/provider-card', () => ({
  default: ({ provider }: { provider: { id: string } }) => <div>card:{provider.id}</div>,
}));
vi.mock('@/hooks/use-household', () => ({ useWhoami: () => useWhoamiMock() }));

const ordinaryMember = { data: { data: { id: 'm1', handle: 'anna', role: 'adult', displayName: 'Anna' } } };
const maintenanceAdmin = { data: { data: { id: 'a1', handle: 'admin', role: 'admin', displayName: 'Admin' } } };

beforeEach(() => useWhoamiMock.mockReturnValue(ordinaryMember));
afterEach(() => { cleanup(); toast.mockClear(); useWhoamiMock.mockReset(); });

describe('ProfilePage', () => {
  it('renders a card per registered provider for an ordinary member', () => {
    render(<ProfilePage />);
    expect(screen.getByText('card:m365')).toBeInTheDocument();
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

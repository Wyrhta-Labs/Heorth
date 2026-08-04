import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import ProfilePage from './profile';

const toast = vi.fn();
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/profile/provider-card', () => ({
  default: ({ provider }: { provider: { id: string } }) => <div>card:{provider.id}</div>,
}));

afterEach(() => { cleanup(); toast.mockClear(); });

describe('ProfilePage', () => {
  it('renders a card per registered provider', () => {
    render(<ProfilePage />);
    expect(screen.getByText('card:m365')).toBeInTheDocument();
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

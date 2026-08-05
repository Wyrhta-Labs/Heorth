import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import HouseholdPage from './household';

const useWhoamiMock = vi.fn();
const useMembersMock = vi.fn();

vi.mock('@/hooks/use-household', () => ({
  useWhoami: () => useWhoamiMock(),
  useMembers: () => useMembersMock(),
  useCreateMember: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateMember: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSetMemberRole: () => ({ mutateAsync: vi.fn() }),
  useDeleteMember: () => ({ mutateAsync: vi.fn() }),
}));

// The Connections tab's own behaviour is covered by connections-panel.test.tsx;
// stubbed here so this page test only exercises household.tsx's tab-gating logic.
vi.mock('@/components/household/connections-panel', () => ({
  default: () => <div>connections-panel-stub</div>,
}));

const members = [
  { id: 'a', role: 'admin' as const, displayName: 'Admin', email: 'admin@example.com', avatarColor: 'ember' as const },
  { id: 'b', role: 'adult' as const, displayName: 'Anna', email: 'anna@example.com', avatarColor: 'sage' as const },
];

function setRole(role: 'admin' | 'adult') {
  useWhoamiMock.mockReturnValue({ data: { data: { role } }, isError: false, refetch: vi.fn() });
  useMembersMock.mockReturnValue({ data: { data: members }, isError: false, refetch: vi.fn() });
}

afterEach(() => {
  cleanup();
  useWhoamiMock.mockReset();
  useMembersMock.mockReset();
});

describe('HouseholdPage tab gating', () => {
  it('shows all four tabs to an admin', () => {
    setRole('admin');
    render(<HouseholdPage />);

    expect(screen.getByRole('button', { name: 'Members' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'API keys' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connections' })).toBeInTheDocument();
  });

  it('shows only the Members tab to a non-admin', () => {
    setRole('adult');
    render(<HouseholdPage />);

    expect(screen.getByRole('button', { name: 'Members' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'API keys' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Connections' })).not.toBeInTheDocument();
  });

  it('still renders the Members content (read-only) for a non-admin', () => {
    setRole('adult');
    render(<HouseholdPage />);

    expect(screen.getByText('Anna')).toBeInTheDocument();
    // Read-only: no add-member action and no per-row edit/delete controls.
    expect(screen.queryByRole('button', { name: /add member/i })).not.toBeInTheDocument();
  });

  it('shows the load error and retries when the members query fails', () => {
    const refetch = vi.fn();
    useWhoamiMock.mockReturnValue({ data: { data: { role: 'admin' } }, isError: false, refetch: vi.fn() });
    useMembersMock.mockReturnValue({ data: undefined, isError: true, refetch });

    render(<HouseholdPage />);

    expect(screen.getByText('We couldn’t load your household.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(refetch).toHaveBeenCalled();
  });
});

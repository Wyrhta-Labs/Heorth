import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import HouseholdKeysPanel from './household-keys-panel';

const revoke = vi.fn(async (id: string) => ({ data: { id } }));
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const anna = { id: 'm1', displayName: 'Anna', avatarColor: 'sage' as const };
const ben = { id: 'm2', displayName: 'Ben', avatarColor: 'sky' as const };

vi.mock('@/hooks/use-api-keys', () => ({
  useHouseholdKeys: () => ({
    data: {
      data: [
        { id: 'k1', name: 'old-script', prefix: 'he_4f2a', createdAt: daysAgo(200), lastUsedAt: null, member: anna },
        { id: 'k2', name: 'laptop-agent', prefix: 'he_88c1', createdAt: daysAgo(10), lastUsedAt: daysAgo(1), member: anna },
        { id: 'k3', name: 'home-assistant', prefix: 'he_19ab', createdAt: daysAgo(5), lastUsedAt: daysAgo(2), member: ben },
      ],
    },
  }),
  useRevokeHouseholdKey: () => ({ mutateAsync: revoke, isPending: false }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/hooks/use-formatters', () => ({ useFormatters: () => ({ formatDate: (s: string) => s.slice(0, 10) }) }));

afterEach(() => { cleanup(); revoke.mockClear(); vi.restoreAllMocks(); });

describe('HouseholdKeysPanel', () => {
  it('groups keys by member with a key count', () => {
    render(<HouseholdKeysPanel readOnly={false} />);
    const annaGroup = screen.getByRole('region', { name: /Anna/ });
    expect(within(annaGroup).getByText('2 keys')).toBeInTheDocument();
    expect(within(annaGroup).getByText('old-script')).toBeInTheDocument();
    expect(within(annaGroup).getByText('laptop-agent')).toBeInTheDocument();
    const benGroup = screen.getByRole('region', { name: /Ben/ });
    expect(within(benGroup).getByText('1 key')).toBeInTheDocument();
    expect(within(benGroup).getByText('home-assistant')).toBeInTheDocument();
  });

  it('badges only the stale keys', () => {
    render(<HouseholdKeysPanel readOnly={false} />);
    expect(screen.getAllByText('stale')).toHaveLength(1);
    const row = screen.getByText('old-script').closest('tr')!;
    expect(within(row).getByText('stale')).toBeInTheDocument();
  });

  it('revokes a member key after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<HouseholdKeysPanel readOnly={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Revoke old-script' }));
    await vi.waitFor(() => expect(revoke).toHaveBeenCalledWith('k1'));
  });

  it('does not revoke when the confirmation is declined', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<HouseholdKeysPanel readOnly={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Revoke old-script' }));
    expect(revoke).not.toHaveBeenCalled();
  });

  it('never offers to mint a key', () => {
    render(<HouseholdKeysPanel readOnly={false} />);
    expect(screen.queryByRole('button', { name: /new key/i })).not.toBeInTheDocument();
  });
});

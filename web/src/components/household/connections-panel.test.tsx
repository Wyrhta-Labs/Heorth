import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ConnectionsPanel from './connections-panel';

const syncNow = vi.fn();
vi.mock('@/hooks/use-household', () => ({
  useMembers: () => ({ data: { data: [
    { id: 'a', role: 'admin', displayName: 'Admin' },
    { id: 'b', role: 'adult', displayName: 'Anna' },
  ] } }),
}));
vi.mock('@/api/m365', () => ({
  getM365Status: vi.fn(),
  triggerM365Sync: (...args: unknown[]) => syncNow(...args),
}));
vi.mock('@/hooks/use-m365', () => ({
  useM365Status: () => ({
    data: { data: {
      connections: [{
        memberId: 'b', accountUpn: 'anna@example.com', status: 'active',
        lastRefreshSuccessAt: '2026-08-04T10:00:00Z', lastRefreshError: null,
      }],
      feeds: [
        { feedKey: 'calendar:member:b', lastSuccessAt: '2026-08-04T10:00:00Z', lastError: null, consecutiveFailures: 0, updatedAt: '' },
        { feedKey: 'todo:member:b:list1', lastSuccessAt: null, lastError: 'needs_reauth', consecutiveFailures: 3, updatedAt: '' },
      ],
    } },
    isLoading: false,
  }),
}));

afterEach(cleanup);

// ConnectionsPanel calls useQueryClient() (to invalidate the M365 status query
// after a manual sync), so it needs a QueryClientProvider ancestor — the
// brief's test snippet predates that wiring and omitted it (same fix as
// provider-card.test.tsx).
function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ConnectionsPanel />
    </QueryClientProvider>,
  );
}

describe('ConnectionsPanel', () => {
  it('shows the connection against its member display name', () => {
    renderPanel();
    expect(screen.getByText('Anna')).toBeInTheDocument();
    expect(screen.getByText('anna@example.com')).toBeInTheDocument();
  });

  it('lists every feed and flags the failing one', () => {
    renderPanel();
    expect(screen.getByText('calendar:member:b')).toBeInTheDocument();
    expect(screen.getByText('todo:member:b:list1')).toBeInTheDocument();
    expect(screen.getByText(/needs_reauth/)).toBeInTheDocument();
  });

  it('triggers a manual sync', async () => {
    syncNow.mockResolvedValue({ data: { results: [] } });
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /sync/i }));
    await waitFor(() => expect(syncNow).toHaveBeenCalled());
  });
});

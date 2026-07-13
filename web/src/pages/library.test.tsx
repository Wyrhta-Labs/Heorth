import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const okList = { data: { data: [], meta: { total: 0 } }, isError: false, isLoading: false, refetch: vi.fn() };
const mutation = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };

vi.mock('@/hooks/use-library', () => ({
  useConnections: () => ({ ...okList, data: { data: [
    { id: 'c1', memberId: 'm1', provider: 'trakt', label: 'Anna’s Trakt', externalRef: 'anna',
      status: 'active', lastSyncedAt: null, lastSyncError: null, itemCount: 12 },
  ] } }),
  useLibraryItems: () => okList,
  useSearchLibrary: () => ({ ...okList }),
  useCreateLibraryThing: () => mutation,
  useSyncConnection: () => mutation,
  useDeleteConnection: () => mutation,
  useImportFile: () => mutation,
  useStartTraktDevice: () => mutation,
  usePollTraktDevice: () => mutation,
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import LibraryPage from './library';

describe('LibraryPage', () => {
  it('renders connected accounts and an empty shelf', () => {
    render(<LibraryPage />);
    expect(screen.getByText(/Anna.s Trakt/)).toBeInTheDocument();
    expect(screen.getByText(/12/)).toBeInTheDocument();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

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

beforeEach(() => {
  localStorage.clear();
});

describe('LibraryPage', () => {
  it('renders connected accounts and an empty shelf', () => {
    render(<LibraryPage />);
    expect(screen.getByText(/Anna.s Trakt/)).toBeInTheDocument();
    expect(screen.getByText(/12/)).toBeInTheDocument();
  });

  it('remembers the shelf filters in this browser, but not the search text', () => {
    const first = render(<LibraryPage />);
    const [type, status, list] = screen.getAllByRole('combobox') as HTMLSelectElement[];
    fireEvent.change(type, { target: { value: 'movie' } });
    fireEvent.change(status, { target: { value: 'watched' } });
    fireEvent.change(list, { target: { value: 'favorites' } });
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'dune' } });
    first.unmount();

    render(<LibraryPage />);
    expect((screen.getAllByRole('combobox') as HTMLSelectElement[]).map((s) => s.value))
      .toEqual(['movie', 'watched', 'favorites']);
    expect(screen.getByPlaceholderText(/search/i)).toHaveValue('');
  });

  it('ignores a remembered filter value the page no longer offers', () => {
    localStorage.setItem('heorth:ui:library:mediaType', '"vinyl"');
    render(<LibraryPage />);
    expect((screen.getAllByRole('combobox')[0] as HTMLSelectElement).value).toBe('');
  });
});

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EthelAsset, Transaction } from '@/lib/types';

const listAssets = vi.fn();
const createAsset = vi.fn();
const getAsset = vi.fn();
const updateAsset = vi.fn();
const decommissionAsset = vi.fn();
const deleteAsset = vi.fn();

const listPlaces = vi.fn((..._args: unknown[]) => Promise.resolve({ data: [] }));
const createPlace = vi.fn();
const updatePlace = vi.fn();
const deletePlace = vi.fn();

vi.mock('@/api/ethel', () => ({
  listAssets: (...args: unknown[]) => listAssets(...args),
  createAsset: (...args: unknown[]) => createAsset(...args),
  getAsset: (...args: unknown[]) => getAsset(...args),
  updateAsset: (...args: unknown[]) => updateAsset(...args),
  decommissionAsset: (...args: unknown[]) => decommissionAsset(...args),
  deleteAsset: (...args: unknown[]) => deleteAsset(...args),
  listPlaces: (...args: unknown[]) => listPlaces(...args),
  createPlace: (...args: unknown[]) => createPlace(...args),
  updatePlace: (...args: unknown[]) => updatePlace(...args),
  deletePlace: (...args: unknown[]) => deletePlace(...args),
}));

const getItemCosts = vi.fn();
const createItemCost = vi.fn();
const deleteItemCost = vi.fn();
const listTransactions = vi.fn();

vi.mock('@/api/feoh', () => ({
  getItemCosts: (...args: unknown[]) => getItemCosts(...args),
  createItemCost: (...args: unknown[]) => createItemCost(...args),
  deleteItemCost: (...args: unknown[]) => deleteItemCost(...args),
  listTransactions: (...args: unknown[]) => listTransactions(...args),
}));

const toast = vi.fn();
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));

import EthelPage from './ethel';

beforeEach(() => {
  // AssetDetail/DecommissionDialog always call useTransactions() for the "link
  // sale" picker, even before an asset is selected — give it a default so
  // react-query doesn't warn about an undefined resolved value in the tests
  // that don't care about transactions.
  listTransactions.mockResolvedValue({ data: [], meta: { total: 0 } });
});

afterEach(() => {
  cleanup();
  listAssets.mockReset();
  createAsset.mockReset();
  getAsset.mockReset();
  updateAsset.mockReset();
  decommissionAsset.mockReset();
  deleteAsset.mockReset();
  getItemCosts.mockReset();
  createItemCost.mockReset();
  deleteItemCost.mockReset();
  listTransactions.mockReset();
  toast.mockReset();
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <EthelPage />
    </QueryClientProvider>,
  );
}

const asset1: EthelAsset = {
  id: 'i1',
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
  name: 'Drill',
  category: 'Tools',
  manufacturer: null,
  model: null,
  serialNumber: null,
  placeId: null,
  locationNote: 'Garage',
  notes: null,
  warrantyUntil: null,
  purchasePrice: '120',
  purchaseDate: '2025-01-01',
  decommissionedAt: null,
  decommissionReason: null,
  disposalProceeds: null,
};

const tx1: Transaction = {
  id: 't1',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  date: '2026-01-01',
  payee: 'Buyer',
  memo: null,
  amount: '50',
  createdBy: 'm1',
};

describe('EthelPage', () => {
  it('renders assets from the mocked listAssets client', async () => {
    listAssets.mockResolvedValue({ data: [asset1], meta: { total: 1 } });
    renderPage();
    await waitFor(() => expect(screen.getByText('Drill')).toBeInTheDocument());
  });

  it('refetches with status=decommissioned when the filter chip is clicked', async () => {
    listAssets.mockResolvedValue({ data: [], meta: { total: 0 } });
    renderPage();
    await waitFor(() => expect(listAssets).toHaveBeenCalled());

    fireEvent.click(screen.getByText('Decommissioned'));

    await waitFor(() =>
      expect(listAssets).toHaveBeenCalledWith(expect.objectContaining({ status: 'decommissioned' })),
    );
  });

  it('shows the TCO panel with the per-year total when an asset is opened', async () => {
    listAssets.mockResolvedValue({ data: [asset1], meta: { total: 1 } });
    getItemCosts.mockResolvedValue({
      data: {
        asset: asset1,
        links: [],
        recurringBills: [],
        totals: { capital: 120, tier2: 0, recurring: 0, proceeds: 0, total: 120, perYear: 40, lifetimeDays: 1095 },
      },
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('Drill')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Drill'));

    await waitFor(() => expect(getItemCosts).toHaveBeenCalledWith('i1'));
    await waitFor(() => expect(screen.getByText('Per year')).toBeInTheDocument());
    expect(screen.getByText('$40.00')).toBeInTheDocument();
  });

  it('refreshes the open detail view and TCO panel after a decommission with no transaction picked', async () => {
    const decommissioned: EthelAsset = {
      ...asset1,
      decommissionedAt: '2026-08-17',
      decommissionReason: 'broken',
      disposalProceeds: '75',
    };
    // First list load returns the active asset; after decommission invalidates
    // the ethel query, the refetch returns the now-decommissioned row.
    listAssets
      .mockResolvedValueOnce({ data: [asset1], meta: { total: 1 } })
      .mockResolvedValue({ data: [decommissioned], meta: { total: 1 } });
    getItemCosts.mockResolvedValue({
      data: {
        asset: asset1,
        links: [],
        recurringBills: [],
        totals: { capital: 120, tier2: 0, recurring: 0, proceeds: 0, total: 120, perYear: 40, lifetimeDays: 1095 },
      },
    });
    decommissionAsset.mockResolvedValue({ data: decommissioned });

    renderPage();
    await waitFor(() => expect(screen.getByText('Drill')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Drill'));
    await waitFor(() => expect(getItemCosts).toHaveBeenCalledTimes(1));

    const openButton = await screen.findByRole('button', { name: 'Decommission' });
    fireEvent.click(openButton);

    const submitButton = screen.getByRole('button', { name: 'Decommission' });
    fireEvent.click(submitButton);

    await waitFor(() => expect(decommissionAsset).toHaveBeenCalledWith('i1', expect.any(Object)));
    // No transaction was picked, so createItemCost must not run.
    expect(createItemCost).not.toHaveBeenCalled();

    // Bug 1: itemCosts must be invalidated (refetched) even without a linked
    // transaction, since decommission itself changes disposalProceeds/total.
    await waitFor(() => expect(getItemCosts.mock.calls.length).toBeGreaterThanOrEqual(2));
    // Bug 2: the open detail view must reflect the refreshed (decommissioned)
    // row instead of the stale `selected` snapshot.
    await waitFor(() => expect(listAssets).toHaveBeenCalledTimes(2));
    // "Decommissioned" also names the status filter chip, so match the
    // specific lifecycle line rather than the bare word.
    await waitFor(() =>
      expect(screen.getAllByText(/Decommissioned Aug 17, 2026 \(Broken\)/).length).toBeGreaterThan(0),
    );
    expect(screen.getByRole('button', { name: 'Decommission' })).toBeDisabled();
  });

  it('decommissions the asset then links the picked sale transaction, tolerating a link failure', async () => {
    listAssets.mockResolvedValue({ data: [asset1], meta: { total: 1 } });
    getItemCosts.mockResolvedValue({
      data: {
        asset: asset1,
        links: [],
        recurringBills: [],
        totals: { capital: 120, tier2: 0, recurring: 0, proceeds: 0, total: 120, perYear: 40, lifetimeDays: 1095 },
      },
    });
    listTransactions.mockResolvedValue({ data: [tx1], meta: { total: 1 } });
    decommissionAsset.mockResolvedValue({ data: { ...asset1, decommissionedAt: '2026-08-17', decommissionReason: 'sold' } });
    createItemCost.mockRejectedValue(new Error('boom'));

    renderPage();
    await waitFor(() => expect(screen.getByText('Drill')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Drill'));

    const openButton = await screen.findByRole('button', { name: 'Decommission' });
    fireEvent.click(openButton);

    const txSelect = await screen.findByLabelText('Link sale transaction');
    fireEvent.change(txSelect, { target: { value: 't1' } });

    const submitButton = screen.getByRole('button', { name: 'Decommission' });
    fireEvent.click(submitButton);

    await waitFor(() => expect(decommissionAsset).toHaveBeenCalledWith('i1', expect.objectContaining({ proceeds: 50 })));
    await waitFor(() =>
      expect(createItemCost).toHaveBeenCalledWith({ transactionId: 't1', itemId: 'i1', kind: 'disposal' }),
    );
    expect(decommissionAsset.mock.invocationCallOrder[0]).toBeLessThan(createItemCost.mock.invocationCallOrder[0]);
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.stringContaining('linking the transaction failed'), 'error'),
    );
  });

  it('create form posts createAsset', async () => {
    listAssets.mockResolvedValue({ data: [], meta: { total: 0 } });
    createAsset.mockResolvedValue({ data: asset1 });
    renderPage();
    await waitFor(() => expect(listAssets).toHaveBeenCalled());

    fireEvent.click(screen.getByText('Add asset'));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Drill' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(createAsset).toHaveBeenCalledWith(expect.objectContaining({ name: 'Drill' })));
  });
});

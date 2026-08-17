import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { InventoryItem, Transaction } from '@/lib/types';

const listItems = vi.fn();
const createItem = vi.fn();
const getItem = vi.fn();
const updateItem = vi.fn();
const decommissionItem = vi.fn();
const deleteItem = vi.fn();

vi.mock('@/api/inventory', () => ({
  listItems: (...args: unknown[]) => listItems(...args),
  createItem: (...args: unknown[]) => createItem(...args),
  getItem: (...args: unknown[]) => getItem(...args),
  updateItem: (...args: unknown[]) => updateItem(...args),
  decommissionItem: (...args: unknown[]) => decommissionItem(...args),
  deleteItem: (...args: unknown[]) => deleteItem(...args),
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

import InventoryPage from './inventory';

beforeEach(() => {
  // ItemDetail/DecommissionDialog always call useTransactions() for the "link
  // sale" picker, even before an item is selected — give it a default so
  // react-query doesn't warn about an undefined resolved value in the tests
  // that don't care about transactions.
  listTransactions.mockResolvedValue({ data: [], meta: { total: 0 } });
});

afterEach(() => {
  cleanup();
  listItems.mockReset();
  createItem.mockReset();
  getItem.mockReset();
  updateItem.mockReset();
  decommissionItem.mockReset();
  deleteItem.mockReset();
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
      <InventoryPage />
    </QueryClientProvider>,
  );
}

const item1: InventoryItem = {
  id: 'i1',
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
  name: 'Drill',
  category: 'Tools',
  manufacturer: null,
  model: null,
  serialNumber: null,
  location: 'Garage',
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

describe('InventoryPage', () => {
  it('renders items from the mocked listItems client', async () => {
    listItems.mockResolvedValue({ data: [item1], meta: { total: 1 } });
    renderPage();
    await waitFor(() => expect(screen.getByText('Drill')).toBeInTheDocument());
  });

  it('refetches with status=decommissioned when the filter chip is clicked', async () => {
    listItems.mockResolvedValue({ data: [], meta: { total: 0 } });
    renderPage();
    await waitFor(() => expect(listItems).toHaveBeenCalled());

    fireEvent.click(screen.getByText('Decommissioned'));

    await waitFor(() =>
      expect(listItems).toHaveBeenCalledWith(expect.objectContaining({ status: 'decommissioned' })),
    );
  });

  it('shows the TCO panel with the per-year total when an item is opened', async () => {
    listItems.mockResolvedValue({ data: [item1], meta: { total: 1 } });
    getItemCosts.mockResolvedValue({
      data: {
        item: item1,
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

  it('decommissions the item then links the picked sale transaction, tolerating a link failure', async () => {
    listItems.mockResolvedValue({ data: [item1], meta: { total: 1 } });
    getItemCosts.mockResolvedValue({
      data: {
        item: item1,
        links: [],
        recurringBills: [],
        totals: { capital: 120, tier2: 0, recurring: 0, proceeds: 0, total: 120, perYear: 40, lifetimeDays: 1095 },
      },
    });
    listTransactions.mockResolvedValue({ data: [tx1], meta: { total: 1 } });
    decommissionItem.mockResolvedValue({ data: { ...item1, decommissionedAt: '2026-08-17', decommissionReason: 'sold' } });
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

    await waitFor(() => expect(decommissionItem).toHaveBeenCalledWith('i1', expect.objectContaining({ proceeds: 50 })));
    await waitFor(() =>
      expect(createItemCost).toHaveBeenCalledWith({ transactionId: 't1', itemId: 'i1', kind: 'disposal' }),
    );
    expect(decommissionItem.mock.invocationCallOrder[0]).toBeLessThan(createItemCost.mock.invocationCallOrder[0]);
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.stringContaining('linking the transaction failed'), 'error'),
    );
  });

  it('create form posts createItem', async () => {
    listItems.mockResolvedValue({ data: [], meta: { total: 0 } });
    createItem.mockResolvedValue({ data: item1 });
    renderPage();
    await waitFor(() => expect(listItems).toHaveBeenCalled());

    fireEvent.click(screen.getByText('Add item'));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Drill' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(createItem).toHaveBeenCalledWith(expect.objectContaining({ name: 'Drill' })));
  });
});

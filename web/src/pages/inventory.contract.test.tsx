/**
 * Contract guard: every list request the inventory page makes must satisfy the
 * SERVER's query schema.
 *
 * This is the test that was missing when the page shipped. `inventory.test.tsx`
 * mocks `@/api/inventory` wholesale, so the params never meet the validator —
 * the page asked for `limit=200` against a schema capped at 100 and every load
 * 400ed with VALIDATION_ERROR while the suite stayed green.
 *
 * So this file imports the real server-side Zod schema — the one cross-project
 * import in the web suite, and a deliberate one: nothing weaker catches param
 * drift, because it takes whatever the page ACTUALLY sends rather than a
 * hand-copied literal. It replays each captured params object through the real
 * `qs()` serializer, so what is validated is the query string as it would go on
 * the wire (strings, `''`/`undefined` already dropped), not the typed object.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { InventoryItem } from '@/lib/types';
import { qs } from '@/api/client';
import { listItemsQuerySchema } from '../../../src/modules/inventory/validators';

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

const listTransactions = vi.fn();
vi.mock('@/api/feoh', () => ({
  getItemCosts: vi.fn(),
  createItemCost: vi.fn(),
  deleteItemCost: vi.fn(),
  listTransactions: (...args: unknown[]) => listTransactions(...args),
}));

vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import InventoryPage from './inventory';

beforeEach(() => {
  listTransactions.mockResolvedValue({ data: [], meta: { total: 0 } });
});

afterEach(() => {
  cleanup();
  listItems.mockReset();
  listTransactions.mockReset();
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <InventoryPage />
    </QueryClientProvider>,
  );
}

const item = (id: string, name: string): InventoryItem => ({
  id,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  name,
  category: 'Tools',
  manufacturer: null,
  model: null,
  serialNumber: null,
  location: 'Garage',
  notes: null,
  warrantyUntil: null,
  purchasePrice: null,
  purchaseDate: null,
  decommissionedAt: null,
  decommissionReason: null,
  disposalProceeds: null,
});

/** Serialize like the browser, then validate like the server. */
function assertServerAccepts(params: Record<string, unknown>) {
  const query = Object.fromEntries(new URLSearchParams(qs(params).replace(/^\?/, '')));
  const parsed = listItemsQuerySchema.safeParse(query);
  expect(
    parsed.success,
    `server would reject ?${new URLSearchParams(query).toString()}: ${
      parsed.success ? '' : JSON.stringify(parsed.error.issues)
    }`,
  ).toBe(true);
}

function assertEveryRequestAccepted() {
  expect(listItems.mock.calls.length).toBeGreaterThan(0);
  for (const [params] of listItems.mock.calls) assertServerAccepts((params ?? {}) as Record<string, unknown>);
}

describe('InventoryPage → server query contract', () => {
  it('sends a first-load request the server accepts', async () => {
    listItems.mockResolvedValue({ data: [item('i1', 'Drill')], meta: { total: 1, limit: 50, offset: 0 } });
    renderPage();
    await waitFor(() => expect(listItems).toHaveBeenCalled());
    assertEveryRequestAccepted();
  });

  it('sends requests the server accepts for every status filter', async () => {
    listItems.mockResolvedValue({ data: [], meta: { total: 0, limit: 50, offset: 0 } });
    renderPage();
    await waitFor(() => expect(listItems).toHaveBeenCalled());

    for (const label of ['Decommissioned', 'Active', 'All']) {
      fireEvent.click(screen.getByText(label));
      await waitFor(() => expect(listItems).toHaveBeenCalled());
    }
    assertEveryRequestAccepted();
  });

  it('sends a search request the server accepts', async () => {
    listItems.mockResolvedValue({ data: [], meta: { total: 0, limit: 50, offset: 0 } });
    renderPage();
    await waitFor(() => expect(listItems).toHaveBeenCalled());

    fireEvent.change(screen.getByPlaceholderText('Search items'), { target: { value: 'drill' } });
    await waitFor(() => expect(listItems).toHaveBeenCalled());
    assertEveryRequestAccepted();
  });

  it('sends a load-more request the server accepts', async () => {
    listItems.mockResolvedValue({
      data: [item('i1', 'Drill')],
      meta: { total: 2, limit: 1, offset: 0 },
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('Drill')).toBeInTheDocument());

    const loadMore = screen.queryByText('Load more');
    expect(loadMore, 'the page must offer load-more while meta.total exceeds the loaded rows').not.toBeNull();
    listItems.mockResolvedValue({
      data: [item('i2', 'Saw')],
      meta: { total: 2, limit: 1, offset: 1 },
    });
    fireEvent.click(loadMore!);

    await waitFor(() => expect(listItems.mock.calls.length).toBeGreaterThan(1));
    assertEveryRequestAccepted();
  });
});

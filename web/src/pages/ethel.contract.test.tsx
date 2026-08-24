/**
 * Contract guard: every list request the Ethel page makes must satisfy the
 * SERVER's query schema.
 *
 * This is the test that was missing when the page shipped. `ethel.test.tsx`
 * mocks `@/api/ethel` wholesale, so the params never meet the validator —
 * the page asked for `limit=200` against a schema capped at 100 and every load
 * 400ed with VALIDATION_ERROR while the suite stayed green.
 *
 * The server's schema cannot be imported here: web/ and the backend are
 * independent dependency trees — the web image stage and the CI web job see
 * neither backend source nor backend node_modules. The contract is therefore
 * mirrored in `@/api/ethel-query` and pinned on both sides: this test
 * validates whatever the page ACTUALLY sends against the mirror, and
 * `tests/ethel-routes.test.ts` pins the server half. It replays each
 * captured params object through the real `qs()` serializer, so what is
 * validated is the query string as it would go on the wire (strings,
 * `''`/`undefined` already dropped), not the typed object.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EthelAsset } from '@/lib/types';
import { qs } from '@/api/client';
import { listAssetsQuerySchema } from '@/api/ethel-query';

const listAssets = vi.fn();
const createAsset = vi.fn();
const getAsset = vi.fn();
const updateAsset = vi.fn();
const decommissionAsset = vi.fn();
const deleteAsset = vi.fn();

vi.mock('@/api/ethel', () => ({
  listAssets: (...args: unknown[]) => listAssets(...args),
  createAsset: (...args: unknown[]) => createAsset(...args),
  getAsset: (...args: unknown[]) => getAsset(...args),
  updateAsset: (...args: unknown[]) => updateAsset(...args),
  decommissionAsset: (...args: unknown[]) => decommissionAsset(...args),
  deleteAsset: (...args: unknown[]) => deleteAsset(...args),
}));

const listTransactions = vi.fn();
vi.mock('@/api/feoh', () => ({
  getItemCosts: vi.fn(),
  createItemCost: vi.fn(),
  deleteItemCost: vi.fn(),
  listTransactions: (...args: unknown[]) => listTransactions(...args),
}));

vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import EthelPage from './ethel';

beforeEach(() => {
  listTransactions.mockResolvedValue({ data: [], meta: { total: 0 } });
});

afterEach(() => {
  cleanup();
  listAssets.mockReset();
  listTransactions.mockReset();
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <EthelPage />
    </QueryClientProvider>,
  );
}

const asset = (id: string, name: string): EthelAsset => ({
  id,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  name,
  category: 'Tools',
  manufacturer: null,
  model: null,
  serialNumber: null,
  placeId: null,
  locationNote: 'Garage',
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
  const parsed = listAssetsQuerySchema.safeParse(query);
  expect(
    parsed.success,
    `server would reject ?${new URLSearchParams(query).toString()}: ${
      parsed.success ? '' : JSON.stringify(parsed.error.issues)
    }`,
  ).toBe(true);
}

function assertEveryRequestAccepted() {
  expect(listAssets.mock.calls.length).toBeGreaterThan(0);
  for (const [params] of listAssets.mock.calls) assertServerAccepts((params ?? {}) as Record<string, unknown>);
}

describe('EthelPage → server query contract', () => {
  it('sends a first-load request the server accepts', async () => {
    listAssets.mockResolvedValue({ data: [asset('i1', 'Drill')], meta: { total: 1, limit: 50, offset: 0 } });
    renderPage();
    await waitFor(() => expect(listAssets).toHaveBeenCalled());
    assertEveryRequestAccepted();
  });

  it('sends requests the server accepts for every status filter', async () => {
    listAssets.mockResolvedValue({ data: [], meta: { total: 0, limit: 50, offset: 0 } });
    renderPage();
    await waitFor(() => expect(listAssets).toHaveBeenCalled());

    for (const label of ['Decommissioned', 'Active', 'All']) {
      fireEvent.click(screen.getByText(label));
      await waitFor(() => expect(listAssets).toHaveBeenCalled());
    }
    assertEveryRequestAccepted();
  });

  it('sends a search request the server accepts', async () => {
    listAssets.mockResolvedValue({ data: [], meta: { total: 0, limit: 50, offset: 0 } });
    renderPage();
    await waitFor(() => expect(listAssets).toHaveBeenCalled());

    fireEvent.change(screen.getByPlaceholderText('Search assets'), { target: { value: 'drill' } });
    await waitFor(() => expect(listAssets).toHaveBeenCalled());
    assertEveryRequestAccepted();
  });

  it('sends a load-more request the server accepts', async () => {
    listAssets.mockResolvedValue({
      data: [asset('i1', 'Drill')],
      meta: { total: 2, limit: 1, offset: 0 },
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('Drill')).toBeInTheDocument());

    const loadMore = screen.queryByText('Load more');
    expect(loadMore, 'the page must offer load-more while meta.total exceeds the loaded rows').not.toBeNull();
    listAssets.mockResolvedValue({
      data: [asset('i2', 'Saw')],
      meta: { total: 2, limit: 1, offset: 1 },
    });
    fireEvent.click(loadMore!);

    await waitFor(() => expect(listAssets.mock.calls.length).toBeGreaterThan(1));
    assertEveryRequestAccepted();
  });
});

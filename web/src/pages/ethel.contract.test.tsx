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

const listPlaces = vi.fn();
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

const listTransactions = vi.fn();
vi.mock('@/api/feoh', () => ({
  getItemCosts: vi.fn(),
  createItemCost: vi.fn(),
  deleteItemCost: vi.fn(),
  listTransactions: (...args: unknown[]) => listTransactions(...args),
}));

vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import EthelPage from './ethel';

const HOUSE = '11111111-1111-4111-8111-111111111111';
const KITCHEN = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  listTransactions.mockResolvedValue({ data: [], meta: { total: 0 } });
  listPlaces.mockResolvedValue({
    data: [
      { id: HOUSE, createdAt: '', updatedAt: '', name: 'House', kind: 'building', parentId: null, notes: null },
      { id: KITCHEN, createdAt: '', updatedAt: '', name: 'Kitchen', kind: 'room', parentId: HOUSE, notes: null },
    ],
  });
});

afterEach(() => {
  cleanup();
  listAssets.mockReset();
  listTransactions.mockReset();
  listPlaces.mockReset();
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

  it('sends a place filter, and the include-contents variant, that the server accepts', async () => {
    listAssets.mockResolvedValue({ data: [], meta: { total: 0, limit: 50, offset: 0 } });
    renderPage();
    await waitFor(() => expect(listAssets).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByLabelText('Place')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Place'), { target: { value: KITCHEN } });
    await waitFor(() => expect(listAssets.mock.calls.some(([p]) => p?.placeId === KITCHEN)).toBe(true));

    fireEvent.click(screen.getByLabelText('Include contents'));
    await waitFor(() =>
      expect(listAssets.mock.calls.some(([p]) => p?.includeDescendants === 'true')).toBe(true),
    );
    assertEveryRequestAccepted();
  });

  it('cannot send includeDescendants without a placeId - the toggle is disabled', async () => {
    // Not a style preference: the server answers 400 VALIDATION_ERROR for
    // includeDescendants without placeId, so the combination must be
    // unreachable in the UI rather than merely unlikely.
    listAssets.mockResolvedValue({ data: [], meta: { total: 0, limit: 50, offset: 0 } });
    renderPage();
    await waitFor(() => expect(listAssets).toHaveBeenCalled());

    const toggle = screen.getByLabelText('Include contents') as HTMLInputElement;
    expect(toggle.disabled).toBe(true);

    // Wait for the place options to exist: setting a <select> to a value it
    // does not offer yet is a no-op, which would make this test pass for the
    // wrong reason.
    await waitFor(() => expect(screen.getByRole('option', { name: /Kitchen/ })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Place'), { target: { value: KITCHEN } });
    await waitFor(() => expect((screen.getByLabelText('Include contents') as HTMLInputElement).disabled).toBe(false));
    fireEvent.click(screen.getByLabelText('Include contents'));
    await waitFor(() => expect(listAssets.mock.calls.some(([p]) => p?.includeDescendants === 'true')).toBe(true));

    // Clearing the place must not leave includeDescendants behind.
    fireEvent.change(screen.getByLabelText('Place'), { target: { value: '' } });
    await waitFor(() => expect((screen.getByLabelText('Include contents') as HTMLInputElement).disabled).toBe(true));
    for (const [params] of listAssets.mock.calls) {
      const p = (params ?? {}) as Record<string, unknown>;
      if (p.includeDescendants !== undefined) expect(p.placeId).toBeTruthy();
    }
    assertEveryRequestAccepted();
  });
});

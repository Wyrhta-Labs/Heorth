import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@/api/client';
import type { EthelAsset, Transaction } from '@/lib/types';

const listAssets = vi.fn();
const createAsset = vi.fn();
const getAsset = vi.fn();
const updateAsset = vi.fn();
const decommissionAsset = vi.fn();
const deleteAsset = vi.fn();
const upsertVehicle = vi.fn();
const deleteVehicle = vi.fn();
const upsertFacility = vi.fn();
const deleteFacility = vi.fn();

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
  upsertVehicle: (...args: unknown[]) => upsertVehicle(...args),
  deleteVehicle: (...args: unknown[]) => deleteVehicle(...args),
  upsertFacility: (...args: unknown[]) => upsertFacility(...args),
  deleteFacility: (...args: unknown[]) => deleteFacility(...args),
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
  // AssetDetail reads the SINGLE-asset endpoint for the inlined vehicle /
  // facility rows; the list row carries neither. Default to an asset with
  // neither detail, and let the tests that care override it.
  getAsset.mockResolvedValue({ data: { ...asset1, vehicle: null, facility: null } });
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
        item: asset1,
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
        item: asset1,
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
        item: asset1,
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

/**
 * The UI half of a server invariant. An asset carries AT MOST ONE detail row -
 * PUT of the second answers 409 ASSET_DETAIL_CONFLICT - so the panel must
 * withdraw the other action rather than offer a call that can only fail.
 *
 * Each case asserts BOTH sides: the panel that must appear, and the action
 * that must be gone. A build that rendered both actions unconditionally
 * satisfies the first assertion and fails the second, which is the point.
 */
describe('AssetDetail detail-row mutual exclusion', () => {
  const openDrill = async () => {
    listAssets.mockResolvedValue({ data: [asset1], meta: { total: 1 } });
    getItemCosts.mockResolvedValue({
      data: {
        item: asset1,
        links: [],
        recurringBills: [],
        totals: { capital: 120, tier2: 0, recurring: 0, proceeds: 0, total: 120, perYear: 40, lifetimeDays: 1095 },
      },
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('Drill')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Drill'));
    await waitFor(() => expect(getAsset).toHaveBeenCalledWith('i1'));
  };

  it('offers BOTH add actions when the asset has neither detail', async () => {
    getAsset.mockResolvedValue({ data: { ...asset1, vehicle: null, facility: null } });
    await openDrill();

    expect(await screen.findByRole('button', { name: 'Add vehicle details' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add facility details' })).toBeInTheDocument();
    // Neither panel is shown until one is asked for.
    expect(screen.queryByLabelText('Registration')).toBeNull();
    expect(screen.queryByLabelText('Facility kind')).toBeNull();
  });

  it('shows the vehicle panel and hides the facility action when a vehicle detail exists', async () => {
    getAsset.mockResolvedValue({
      data: {
        ...asset1,
        vehicle: {
          assetId: 'i1', registration: 'AB-CD 123', vin: null,
          firstRegisteredOn: null, odometer: null, odometerReadAt: null, serviceIntervalMonths: 12,
        },
        facility: null,
      },
    });
    await openDrill();

    expect(await screen.findByLabelText('Registration')).toHaveValue('AB-CD 123');
    expect(screen.queryByRole('button', { name: 'Add facility details' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add vehicle details' })).toBeNull();
  });

  it('shows the facility panel and hides the vehicle action when a facility detail exists', async () => {
    getAsset.mockResolvedValue({
      data: {
        ...asset1,
        vehicle: null,
        facility: {
          assetId: 'i1', kind: 'heating', commissionedOn: '2020-05-01',
          serviceIntervalMonths: 12, servesPlaceIds: [],
        },
      },
    });
    await openDrill();

    expect(await screen.findByLabelText('Facility kind')).toHaveValue('heating');
    expect(screen.queryByRole('button', { name: 'Add vehicle details' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add facility details' })).toBeNull();
  });

  it('enables the odometer reading date only once a mileage is entered', async () => {
    // The table has a CHECK, mirrored in the validator, that the two are set
    // together. The form must not be able to construct that 400.
    getAsset.mockResolvedValue({ data: { ...asset1, vehicle: null, facility: null } });
    await openDrill();

    fireEvent.click(await screen.findByRole('button', { name: 'Add vehicle details' }));
    const readAt = (await screen.findByLabelText('Odometer read on')) as HTMLInputElement;
    expect(readAt.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Odometer (km)'), { target: { value: '120000' } });
    await waitFor(() => expect((screen.getByLabelText('Odometer read on') as HTMLInputElement).disabled).toBe(false));
    expect((screen.getByLabelText('Odometer read on') as HTMLInputElement).required).toBe(true);

    // Clearing the mileage takes the date with it, so the pair can never be
    // half-filled in either direction.
    fireEvent.change(screen.getByLabelText('Odometer read on'), { target: { value: '2026-08-01' } });
    fireEvent.change(screen.getByLabelText('Odometer (km)'), { target: { value: '' } });
    await waitFor(() => expect((screen.getByLabelText('Odometer read on') as HTMLInputElement).value).toBe(''));
  });

  it('submits the full servesPlaceIds set, because the server replaces it wholesale', async () => {
    getAsset.mockResolvedValue({ data: { ...asset1, vehicle: null, facility: null } });
    upsertFacility.mockResolvedValue({ data: { assetId: 'i1', kind: 'heating', commissionedOn: null, serviceIntervalMonths: null, servesPlaceIds: [] } });
    await openDrill();

    fireEvent.click(await screen.findByRole('button', { name: 'Add facility details' }));
    fireEvent.change(await screen.findByLabelText('Facility kind'), { target: { value: 'water' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]!);

    await waitFor(() =>
      expect(upsertFacility).toHaveBeenCalledWith('i1', expect.objectContaining({ kind: 'water', servesPlaceIds: [] })),
    );
  });

  it('turns VEHICLE_REGISTRATION_TAKEN into a sentence rather than a code', async () => {
    getAsset.mockResolvedValue({ data: { ...asset1, vehicle: null, facility: null } });
    upsertVehicle.mockRejectedValue(new ApiError(409, 'VEHICLE_REGISTRATION_TAKEN', 'nope'));
    await openDrill();

    fireEvent.click(await screen.findByRole('button', { name: 'Add vehicle details' }));
    fireEvent.change(await screen.findByLabelText('Registration'), { target: { value: 'AB-CD 123' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]!);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('already recorded');
    expect(alert.textContent).not.toContain('VEHICLE_REGISTRATION_TAKEN');
  });

  it('says in the UI that the service interval is documentation, not a schedule', async () => {
    getAsset.mockResolvedValue({ data: { ...asset1, vehicle: null, facility: null } });
    await openDrill();

    fireEvent.click(await screen.findByRole('button', { name: 'Add vehicle details' }));
    expect(await screen.findByText('From the manual. Recording a routine that acts on it comes later.')).toBeInTheDocument();
  });
});

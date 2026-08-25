import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EthelAsset, EthelAssetDetail, RoutineView } from '@/lib/types';

const getAsset = vi.fn();
vi.mock('@/api/ethel', () => ({ getAsset: (...args: unknown[]) => getAsset(...args) }));
vi.mock('@/hooks/use-household', () => ({ useHouseholdMembers: () => ({ data: { data: [] } }) }));

import RoutineForm from './routine-form';

afterEach(() => {
  cleanup();
  getAsset.mockReset();
});

function renderForm(routine: RoutineView | null, assets: EthelAsset[] = []) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RoutineForm
        routine={routine}
        assets={assets}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

const boiler: EthelAsset = {
  id: 'a1', createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z',
  name: 'Boiler', category: 'Heating', manufacturer: null, model: null, serialNumber: null,
  placeId: null, locationNote: null, notes: null, warrantyUntil: null,
  purchasePrice: null, purchaseDate: null, decommissionedAt: null, decommissionReason: null,
  disposalProceeds: null,
};

const boilerDetail: EthelAssetDetail = {
  ...boiler,
  vehicle: null,
  facility: { assetId: 'a1', kind: 'heating', commissionedOn: null, serviceIntervalMonths: 12, servesPlaceIds: [] },
};

const existingRoutine: RoutineView = {
  id: 'r1', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  name: 'Service the boiler', notes: null, mode: 'from_completion',
  intervalUnit: 'month', intervalCount: 18, anchorDate: '2026-01-01', leadDays: 0,
  ownerMemberId: null, anchorAssetId: 'a1', anchorPlaceId: null, active: true,
  nextDueOn: '2026-07-01', openOccurrence: null,
};

describe('RoutineForm — serviceIntervalMonths is a default, never a trigger', () => {
  it('does NOT overwrite an existing asset-anchored routine\'s own interval just by opening it', async () => {
    // The plate says 12 months; the household deliberately chose 18. Opening
    // the edit form re-fetches the asset (for the picker's benefit) but must
    // never silently revert the routine's own stored value - that would make
    // Ethel's documentation authoritative over the household's decision,
    // which is exactly what ADR 0013/0014 rule out.
    getAsset.mockResolvedValue({ data: boilerDetail });
    renderForm(existingRoutine, [boiler]);

    await waitFor(() => expect(getAsset).toHaveBeenCalledWith('a1'));
    // Give the (absent) effect a chance to have run if it were going to -
    // `waitFor` polls (wrapped in `act`) rather than a bare timer, so any
    // resulting re-render is properly flushed either way.
    await waitFor(() => expect(screen.getByLabelText(/every/i)).toHaveValue(18));
    expect(screen.getByRole('radio', { name: 'mode-from-completion' })).toBeChecked();
  });

  it('DOES prefill from serviceIntervalMonths when the maker freshly ties a NEW routine to that asset', async () => {
    getAsset.mockResolvedValue({ data: boilerDetail });
    renderForm(null, [boiler]);

    await userEventSelectAsset();

    await waitFor(() => expect(screen.getByLabelText(/every/i)).toHaveValue(12));
    expect(screen.getByRole('radio', { name: 'mode-from-completion' })).toBeChecked();

    async function userEventSelectAsset() {
      const { default: userEvent } = await import('@testing-library/user-event');
      await userEvent.click(screen.getByRole('radio', { name: 'anchor-asset' }));
      await userEvent.selectOptions(screen.getByLabelText('Asset'), 'a1');
    }
  });
});

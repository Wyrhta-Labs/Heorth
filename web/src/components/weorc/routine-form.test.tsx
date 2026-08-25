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

function renderForm(routine: RoutineView | null, assets: EthelAsset[] = [], today?: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <RoutineForm
        routine={routine}
        assets={assets}
        today={today}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    </QueryClientProvider>,
  );
  return {
    ...utils,
    rerenderWithToday: (nextRoutine: RoutineView | null, nextAssets: EthelAsset[], nextToday?: string) => utils.rerender(
      <QueryClientProvider client={qc}>
        <RoutineForm
          routine={nextRoutine}
          assets={nextAssets}
          today={nextToday}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
        />
      </QueryClientProvider>,
    ),
  };
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

    // Wait for the anchor-asset detail query to actually SETTLE, not merely
    // to have been called - `18` is also what the field reads on the very
    // first render, before the query resolves and the prefill effect gets
    // its chance to run. Asserting right after `toHaveBeenCalledWith` would
    // pass trivially at a moment the guard has not been exercised yet, which
    // is exactly how this test previously could not fail on the broken code
    // it exists to catch (see the fix-round-2 report for the revert proof).
    await waitFor(() => expect(screen.getByLabelText(/every/i)).toHaveAttribute('data-asset-detail-settled', 'true'));

    expect(screen.getByLabelText(/every/i)).toHaveValue(18);
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

describe('RoutineForm — the anchor-date default is the same shape: a DEFAULT, never a trigger', () => {
  afterEach(() => vi.useRealTimers());

  it('updates a NEW, untouched anchorDate when `today` arrives late (household timezone resolving after mount)', () => {
    // Pin the browser's own clock to a date far from the household date this
    // test uses below, so the browser-clock FALLBACK and the household VALUE
    // can never accidentally coincide (which would make this assertion pass
    // for the wrong reason on whatever day the suite happens to run).
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2020-01-01T00:00:00Z'));
    // The form mounts before the caller's household query has resolved -
    // exactly like production, where `today` starts undefined/fallback and
    // is fed in once useHousehold() settles.
    const { rerenderWithToday } = renderForm(null, [], undefined);
    expect(screen.getByLabelText(/anchor date/i)).not.toHaveValue('2026-08-25');

    rerenderWithToday(null, [], '2026-08-25');
    expect(screen.getByLabelText(/anchor date/i)).toHaveValue('2026-08-25');
  });

  it('never overwrites the anchorDate once the maker has TOUCHED it, however `today` changes afterward', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const { rerenderWithToday } = renderForm(null, [], '2026-08-25');
    expect(screen.getByLabelText(/anchor date/i)).toHaveValue('2026-08-25');

    await userEvent.clear(screen.getByLabelText(/anchor date/i));
    await userEvent.type(screen.getByLabelText(/anchor date/i), '2026-09-01');
    expect(screen.getByLabelText(/anchor date/i)).toHaveValue('2026-09-01');

    // `today` changing after the touch (e.g. a slow household query resolving
    // even later, or simply the day rolling over) must not revert the pick.
    rerenderWithToday(null, [], '2026-09-15');
    expect(screen.getByLabelText(/anchor date/i)).toHaveValue('2026-09-01');
  });

  it('never touches an EXISTING routine\'s stored anchorDate, whatever `today` does', () => {
    const { rerenderWithToday } = renderForm(existingRoutine, [boiler], undefined);
    expect(screen.getByLabelText(/anchor date/i)).toHaveValue('2026-01-01');

    rerenderWithToday(existingRoutine, [boiler], '2026-08-25');
    expect(screen.getByLabelText(/anchor date/i)).toHaveValue('2026-01-01');
  });
});

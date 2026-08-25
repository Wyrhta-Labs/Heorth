import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as api from '@/api/weorc';

vi.mock('@/api/weorc');

import WeorcPage from './weorc';

const TODAY = '2026-08-25';
const routine = (over = {}) => ({
  id: 'r1', name: 'Put the bins out', notes: null, mode: 'fixed',
  intervalUnit: 'week', intervalCount: 1, anchorDate: TODAY, leadDays: 0,
  ownerMemberId: null, anchorAssetId: null, anchorPlaceId: null, active: true,
  nextDueOn: TODAY, openOccurrence: null, ...over,
});
const occurrence = (over = {}) => ({
  id: 'o1', routineId: 'r1', dueOn: TODAY, status: 'due', completedAt: null,
  completedByMemberId: null, note: null, taskFeedKey: null,
  taskExternalId: null, projectionError: null, ...over,
});
const listing = (...rows: unknown[]) => ({ data: rows, meta: { total: rows.length } });

function renderWeorc() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <WeorcPage />
    </QueryClientProvider>,
  );
}

describe('the Weorc page', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Pin "today" to the date the fixtures below assume. Without this, the
    // "Coming up" fixture (`2026-09-08`) eventually becomes the PAST relative
    // to the real clock and the due/coming-up split test fails for a reason
    // that has nothing to do with the code under test.
    // `shouldAdvanceTime` lets real async work (userEvent's internal waits,
    // react-query's promises) keep progressing in real time even though
    // `Date`/`Date.now()` stay frozen.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`));
  });
  afterEach(() => {
    cleanup();
    // Restored even if an assertion above threw - afterEach always runs.
    vi.useRealTimers();
  });

  it('shows work due today under "Due now"', async () => {
    vi.mocked(api.listRoutines).mockResolvedValue(listing(routine({ openOccurrence: occurrence() })) as never);
    renderWeorc();
    await screen.findByText('Put the bins out');
    expect(within(screen.getByTestId('due-now')).getByText('Put the bins out')).toBeInTheDocument();
  });

  it('puts lead-window work under "Coming up", NOT under "Due now"', async () => {
    // A boiler service materialised 14 days early is not due today. Showing it
    // as due is the exact failure this test exists to prevent.
    const later = occurrence({ id: 'o2', dueOn: '2026-09-08' });
    vi.mocked(api.listRoutines).mockResolvedValue(listing(routine({ name: 'Service the boiler', openOccurrence: later })) as never);
    renderWeorc();
    await screen.findByText('Service the boiler');
    expect(within(screen.getByTestId('coming-up')).getByText('Service the boiler')).toBeInTheDocument();
    expect(within(screen.getByTestId('due-now')).queryByText('Service the boiler')).toBeNull();
  });

  it('ticking one calls completeOccurrence and clears it from Due now', async () => {
    vi.mocked(api.listRoutines).mockResolvedValue(listing(routine({ openOccurrence: occurrence() })) as never);
    vi.mocked(api.completeOccurrence).mockResolvedValue({
      data: {
        occurrence: occurrence({ status: 'completed', completedAt: '2026-08-25T09:00:00Z' }),
        next: null, projection: { ok: true },
      },
    } as never);
    renderWeorc();
    await userEvent.click(await screen.findByRole('button', { name: /done/i }));
    expect(api.completeOccurrence).toHaveBeenCalledWith('o1', expect.anything());
    await waitFor(() => {
      expect(within(screen.getByTestId('due-now')).queryByText('Put the bins out')).toBeNull();
    });
  });

  it('skipping calls skipOccurrence', async () => {
    vi.mocked(api.listRoutines).mockResolvedValue(listing(routine({ openOccurrence: occurrence() })) as never);
    vi.mocked(api.skipOccurrence).mockResolvedValue({
      data: { occurrence: occurrence({ status: 'skipped' }), next: null, projection: { ok: false } },
    } as never);
    renderWeorc();
    await userEvent.click(await screen.findByRole('button', { name: /skip/i }));
    expect(api.skipOccurrence).toHaveBeenCalledWith('o1', expect.anything());
  });

  it('renders an UNPROJECTED occurrence plainly — no error styling anywhere', async () => {
    // In the demo stack EVERY occurrence is unprojected, permanently. Treating
    // that as a fault would make the whole page look broken.
    vi.mocked(api.listRoutines).mockResolvedValue(listing(routine({ openOccurrence: occurrence() })) as never);
    renderWeorc();
    const nameNode = await screen.findByText('Put the bins out');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/couldn't reach your task list/i)).toBeNull();
    // Positive pin: the row is in the explicit "ok" state, not merely absent
    // an error class — this fails if the plain styling regresses even when it
    // regresses to something other than what today's error state looks like.
    expect(nameNode.closest('li')).toHaveAttribute('data-projection', 'ok');
  });

  it('surfaces a projection problem quietly, and still shows the chore as due', async () => {
    const failed = occurrence({ projectionError: 'needs_reauth' });
    vi.mocked(api.listRoutines).mockResolvedValue(listing(routine({ openOccurrence: failed })) as never);
    renderWeorc();
    expect(await screen.findByText(/couldn't reach your task list/i)).toBeInTheDocument();
    expect(within(screen.getByTestId('due-now')).getByText('Put the bins out')).toBeInTheDocument();
  });

  it('creates a routine with NO anchor — the normal case', async () => {
    vi.mocked(api.listRoutines).mockResolvedValue(listing() as never);
    vi.mocked(api.createRoutine).mockResolvedValue({ data: routine() } as never);
    renderWeorc();
    await userEvent.click(await screen.findByRole('button', { name: /new routine/i }));
    await userEvent.type(screen.getByLabelText(/name/i), 'Change the bedding');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(api.createRoutine).toHaveBeenCalled());
    expect(vi.mocked(api.createRoutine).mock.calls[0]![0]).toMatchObject({
      name: 'Change the bedding', anchorAssetId: null, anchorPlaceId: null,
    });
  });

  it('tells the maker when an edit only applies from the next cycle', async () => {
    const projected = occurrence({ taskFeedKey: 'todo:member:m:l', taskExternalId: 'ext-1' });
    vi.mocked(api.listRoutines).mockResolvedValue(listing(routine({ openOccurrence: projected })) as never);
    vi.mocked(api.updateRoutine).mockResolvedValue({
      data: { ...routine(), openOccurrenceUnchanged: true },
    } as never);
    renderWeorc();
    await userEvent.click(await screen.findByRole('button', { name: /edit/i }));
    await userEvent.clear(screen.getByLabelText(/every/i));
    await userEvent.type(screen.getByLabelText(/every/i), '2');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(await screen.findByText(/applies from the next time it comes round/i)).toBeInTheDocument();
  });
});

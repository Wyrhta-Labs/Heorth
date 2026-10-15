import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as weorc from '@/api/weorc';
import * as tasks from '@/api/tasks';
import { useHousehold } from '@/hooks/use-household';

vi.mock('@/api/weorc');
vi.mock('@/api/tasks');
vi.mock('@/hooks/use-household');

import DueWork from './due-work';

const routine = (id: string, name: string, dueOn: string | null) => ({
  id, name, notes: null, mode: 'fixed', intervalUnit: 'week', intervalCount: 1, anchorDate: '2026-09-01',
  leadDays: 0, ownerMemberId: null, anchorAssetId: null, anchorPlaceId: null, active: true,
  nextDueOn: dueOn ?? '2026-11-01',
  openOccurrence: dueOn ? {
    id: `o-${id}`, routineId: id, dueOn, status: 'due', completedAt: null, completedByMemberId: null,
    note: null, taskFeedKey: null, taskExternalId: null, projectionError: null,
  } : null,
});
const listing = (...rows: unknown[]) => ({ data: rows, meta: { total: rows.length } });

function renderDueWork() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><DueWork /></QueryClientProvider>);
}

describe('DueWork', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-04T12:00:00Z'));
    vi.mocked(useHousehold).mockReturnValue({ data: { data: { timezone: 'Europe/Berlin' } } } as never);
    vi.mocked(weorc.listRoutines).mockResolvedValue(listing(
      routine('r1', 'Clean the oven', '2026-09-22'),
      routine('r2', 'Put the bins out', '2026-10-05'),
      routine('r3', 'Service the boiler', '2026-10-08'),
      routine('r4', 'Mow the lawn', null),
    ) as never);
    vi.mocked(tasks.listTasks).mockResolvedValue(listing(
      { id: 't1', title: 'Call the orthodontist', dueAt: null, status: 'open' },
    ) as never);
    vi.mocked(weorc.completeOccurrence).mockResolvedValue({ data: { next: null } } as never);
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.resetAllMocks(); });

  it('lists chores due through tomorrow (overdue included) and the open tasks', async () => {
    renderDueWork();
    expect(await screen.findByText('Clean the oven')).toBeInTheDocument();
    expect(screen.getByText('Put the bins out')).toBeInTheDocument();
    expect(screen.queryByText('Service the boiler')).not.toBeInTheDocument();
    expect(screen.queryByText('Mow the lawn')).not.toBeInTheDocument();
    expect(await screen.findByText('Call the orthodontist')).toBeInTheDocument();
    expect(tasks.listTasks).toHaveBeenCalledWith({ status: 'open' });
  });

  it('completes a chore from the card only on the second press', async () => {
    const user = userEvent.setup();
    renderDueWork();
    await screen.findByText('Clean the oven');
    await user.click(screen.getAllByRole('button', { name: 'Done' })[0]!);
    expect(weorc.completeOccurrence).not.toHaveBeenCalled();
    const confirm = screen.getByRole('button', { name: 'Sure?' });
    await user.click(confirm);
    await waitFor(() => expect(weorc.completeOccurrence).toHaveBeenCalledWith('o-r1', {}));
    // Once sent it cannot fire again before the list refreshes.
    expect(confirm).toBeDisabled();
    await user.click(confirm);
    expect(weorc.completeOccurrence).toHaveBeenCalledTimes(1);
  });

  it('disarms the confirmation after a few seconds', async () => {
    renderDueWork();
    await screen.findByText('Clean the oven');
    // Swap the Date-only fake for one that also drives setTimeout.
    vi.useRealTimers();
    vi.useFakeTimers();
    fireEvent.click(screen.getAllByRole('button', { name: 'Done' })[0]!);
    expect(screen.getByRole('button', { name: 'Sure?' })).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(4000); });
    expect(screen.queryByRole('button', { name: 'Sure?' })).not.toBeInTheDocument();
    expect(weorc.completeOccurrence).not.toHaveBeenCalled();
  });

  it('with a later focused day, runs chores through it and highlights what is due that day', async () => {
    vi.mocked(tasks.listTasks).mockResolvedValue(listing(
      { id: 't1', title: 'Call the orthodontist', dueAt: null, status: 'open' },
      { id: 't2', title: 'Return the parcel', dueAt: '2026-10-08T08:00:00Z', status: 'open' },
    ) as never);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><DueWork day="2026-10-08" /></QueryClientProvider>);
    const boiler = await screen.findByText('Service the boiler');
    expect(boiler.closest('li')).toHaveAttribute('data-highlight', 'true');
    expect(screen.getByText('Clean the oven').closest('li')).not.toHaveAttribute('data-highlight');
    expect((await screen.findByText('Return the parcel')).closest('li')).toHaveAttribute('data-highlight', 'true');
    expect(screen.getByText('Call the orthodontist').closest('li')).not.toHaveAttribute('data-highlight');
  });
});

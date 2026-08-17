import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { OccurrenceEntry, Transaction } from '@/lib/types';

const listOccurrences = vi.fn();
const linkOccurrence = vi.fn();
const skipOccurrence = vi.fn();
const unskipOccurrence = vi.fn();
const unlinkOccurrence = vi.fn();
const overrideOccurrence = vi.fn();
const listTransactions = vi.fn();

vi.mock('@/api/feoh', () => ({
  listOccurrences: (...args: unknown[]) => listOccurrences(...args),
  linkOccurrence: (...args: unknown[]) => linkOccurrence(...args),
  skipOccurrence: (...args: unknown[]) => skipOccurrence(...args),
  unskipOccurrence: (...args: unknown[]) => unskipOccurrence(...args),
  unlinkOccurrence: (...args: unknown[]) => unlinkOccurrence(...args),
  overrideOccurrence: (...args: unknown[]) => overrideOccurrence(...args),
  listTransactions: (...args: unknown[]) => listTransactions(...args),
}));

import OccurrenceStrip, { OverdueBadge } from './occurrence-strip';

afterEach(() => {
  cleanup();
  listOccurrences.mockReset();
  linkOccurrence.mockReset();
  skipOccurrence.mockReset();
  unskipOccurrence.mockReset();
  unlinkOccurrence.mockReset();
  overrideOccurrence.mockReset();
  listTransactions.mockReset();
});

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const occ = (over: Partial<OccurrenceEntry>): OccurrenceEntry => ({
  billId: 'b1',
  payee: 'Landlord',
  dueDate: '2026-08-01',
  status: 'planned',
  expectedAmount: 900,
  overrideAmount: null,
  transactionId: null,
  offSchedule: false,
  cadenceUnknown: false,
  ...over,
});

const tx1: Transaction = {
  id: 't1', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  date: '2026-08-01', payee: 'Landlord', memo: null, amount: '900', createdBy: 'm1',
};

describe('OccurrenceStrip', () => {
  it('renders occurrences with status chips', async () => {
    listOccurrences.mockResolvedValue({ data: [occ({ dueDate: '2026-08-01', status: 'planned' }), occ({ dueDate: '2026-09-01', status: 'overdue' })] });
    listTransactions.mockResolvedValue({ data: [], meta: { total: 0 } });
    renderWithClient(<OccurrenceStrip billId="b1" />);

    await waitFor(() => expect(listOccurrences).toHaveBeenCalledWith({ billId: 'b1' }));
    expect(await screen.findByText('Planned')).toBeInTheDocument();
    expect(await screen.findByText('Overdue')).toBeInTheDocument();
  });

  it('books an occurrence by picking a transaction', async () => {
    listOccurrences.mockResolvedValue({ data: [occ({})] });
    listTransactions.mockResolvedValue({ data: [tx1], meta: { total: 1 } });
    linkOccurrence.mockResolvedValue({ data: { ok: true } });
    renderWithClient(<OccurrenceStrip billId="b1" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Book' }));
    const picker = await screen.findByLabelText('Pick the settling transaction');
    fireEvent.change(picker, { target: { value: 't1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() =>
      expect(linkOccurrence).toHaveBeenCalledWith({ billId: 'b1', dueDate: '2026-08-01', transactionId: 't1' }),
    );
  });

  it('skips a planned occurrence', async () => {
    listOccurrences.mockResolvedValue({ data: [occ({})] });
    listTransactions.mockResolvedValue({ data: [], meta: { total: 0 } });
    skipOccurrence.mockResolvedValue({ data: { ok: true } });
    renderWithClient(<OccurrenceStrip billId="b1" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Skip' }));

    await waitFor(() => expect(skipOccurrence).toHaveBeenCalledWith({ billId: 'b1', dueDate: '2026-08-01' }));
  });

  it('adjusts the amount override', async () => {
    listOccurrences.mockResolvedValue({ data: [occ({ overrideAmount: 950 })] });
    listTransactions.mockResolvedValue({ data: [], meta: { total: 0 } });
    overrideOccurrence.mockResolvedValue({ data: { ok: true } });
    renderWithClient(<OccurrenceStrip billId="b1" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Adjust amount' }));
    const input = await screen.findByLabelText('Adjust amount');
    fireEvent.change(input, { target: { value: '1000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() =>
      expect(overrideOccurrence).toHaveBeenCalledWith({ billId: 'b1', dueDate: '2026-08-01', amount: 1000 }),
    );
  });

  it('clears an override by submitting an empty amount', async () => {
    listOccurrences.mockResolvedValue({ data: [occ({ overrideAmount: 950 })] });
    listTransactions.mockResolvedValue({ data: [], meta: { total: 0 } });
    overrideOccurrence.mockResolvedValue({ data: { ok: true } });
    renderWithClient(<OccurrenceStrip billId="b1" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Adjust amount' }));
    const input = await screen.findByLabelText('Adjust amount');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() =>
      expect(overrideOccurrence).toHaveBeenCalledWith({ billId: 'b1', dueDate: '2026-08-01', amount: null }),
    );
  });

  it('renders the unknown-cadence label with no action buttons', async () => {
    listOccurrences.mockResolvedValue({ data: [occ({ status: 'unknown', cadenceUnknown: true })] });
    listTransactions.mockResolvedValue({ data: [], meta: { total: 0 } });
    renderWithClient(<OccurrenceStrip billId="b1" />);

    expect(await screen.findByText('Cadence unknown - edit the bill')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Book' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Skip' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Adjust amount' })).not.toBeInTheDocument();
  });
});

describe('OverdueBadge', () => {
  it('shows the aggregate overdue count', async () => {
    listOccurrences.mockResolvedValue({ data: [occ({ status: 'overdue' }), occ({ status: 'overdue', dueDate: '2026-09-01' })] });
    renderWithClient(<OverdueBadge />);

    await waitFor(() => expect(listOccurrences).toHaveBeenCalledWith({ status: 'overdue' }));
    expect(await screen.findByText('2 overdue')).toBeInTheDocument();
  });

  it('renders nothing when there are no overdue occurrences', async () => {
    listOccurrences.mockResolvedValue({ data: [] });
    renderWithClient(<OverdueBadge />);

    await waitFor(() => expect(listOccurrences).toHaveBeenCalled());
    expect(screen.queryByText(/overdue/)).not.toBeInTheDocument();
  });
});

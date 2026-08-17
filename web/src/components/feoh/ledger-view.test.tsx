import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { LedgerEntry, LedgerMeta } from '@/lib/types';

const getAccountLedger = vi.fn();

vi.mock('@/api/feoh', () => ({
  getAccountLedger: (...args: unknown[]) => getAccountLedger(...args),
}));

import LedgerView from './ledger-view';

afterEach(() => {
  cleanup();
  getAccountLedger.mockReset();
});

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const meta = (over: Partial<LedgerMeta> = {}): LedgerMeta => ({
  total: 2, limit: 50, offset: 0, openingBalance: 100, endBalance: -650, ...over,
});
const page1: LedgerEntry[] = [
  { transactionId: 't1', date: '2026-08-01', payee: 'Market', memo: null, delta: 150, balance: 250 },
];
const page2: LedgerEntry[] = [
  { transactionId: 't2', date: '2026-07-01', payee: 'Rent', memo: null, delta: -900, balance: -650 },
];

describe('LedgerView', () => {
  it('fetches the first page with offset 0 and renders its rows', async () => {
    getAccountLedger.mockResolvedValue({ data: page1, meta: meta({ offset: 0 }) });
    renderWithClient(<LedgerView accountId="a1" />);

    await waitFor(() => expect(getAccountLedger).toHaveBeenCalledWith('a1', { limit: 50, offset: 0 }));
    expect(await screen.findByText('Market')).toBeInTheDocument();
  });

  it('load more fetches the NEXT page via offset 50 and appends its rows without re-fetching page 1', async () => {
    getAccountLedger.mockImplementation((_id: string, params: { limit?: number; offset?: number } = {}) => {
      if ((params.offset ?? 0) === 0) return Promise.resolve({ data: page1, meta: meta({ offset: 0 }) });
      return Promise.resolve({ data: page2, meta: meta({ offset: 50 }) });
    });
    renderWithClient(<LedgerView accountId="a1" />);

    expect(await screen.findByText('Market')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

    await waitFor(() => expect(getAccountLedger).toHaveBeenCalledWith('a1', { limit: 50, offset: 50 }));
    expect(await screen.findByText('Rent')).toBeInTheDocument();
    // Both pages' rows are present at once — page 1 was appended to, not replaced.
    expect(screen.getByText('Market')).toBeInTheDocument();
    // Never re-requested with the already-loaded offset 0 a second time.
    expect(getAccountLedger.mock.calls.filter((c) => c[1]?.offset === 0)).toHaveLength(1);
  });

  it('hides load more once every row has been fetched', async () => {
    getAccountLedger.mockResolvedValue({ data: page1, meta: meta({ total: 1, offset: 0 }) });
    renderWithClient(<LedgerView accountId="a1" />);

    await screen.findByText('Market');
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });
});

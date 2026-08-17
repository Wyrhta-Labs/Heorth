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

  it('replaces stale rows when an invalidation refetch (e.g. after reconciling) delivers a fresh page for an already-loaded offset', async () => {
    const reconciledPage: LedgerEntry[] = [
      { transactionId: 't3', date: '2026-08-16', payee: 'Kassensturz adjustment', memo: null, delta: -50, balance: 200 },
    ];
    let call = 0;
    getAccountLedger.mockImplementation(() => {
      call += 1;
      if (call === 1) return Promise.resolve({ data: page1, meta: meta({ total: 1, offset: 0, endBalance: 250 }) });
      return Promise.resolve({ data: reconciledPage, meta: meta({ total: 1, offset: 0, endBalance: 200 }) });
    });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><LedgerView accountId="a1" /></QueryClientProvider>);

    expect(await screen.findByText('Market')).toBeInTheDocument();
    // Give the first fetch's dataUpdatedAt a distinct timestamp from the refetch below.
    await new Promise((resolve) => setTimeout(resolve, 5));

    // Simulate reconcileAccount's onSuccess invalidating the ledger key prefix
    // (see useReconcileAccount in use-feoh.ts) while this page is mounted.
    await qc.invalidateQueries({ queryKey: ['ledger', 'a1'] });

    expect(await screen.findByText('Kassensturz adjustment')).toBeInTheDocument();
    expect(screen.queryByText('Market')).not.toBeInTheDocument();
  });

  it('restarts at page 0 (no lost rows, no offset desync) when an invalidation refetch lands on a later, already-loaded page, and load more still works afterward', async () => {
    let reconciled = false;
    const preOffset0: LedgerEntry[] = [
      { transactionId: 't1', date: '2026-08-01', payee: 'Market', memo: null, delta: 150, balance: 250 },
    ];
    const preOffset50: LedgerEntry[] = [
      { transactionId: 't2', date: '2026-07-01', payee: 'Rent', memo: null, delta: -900, balance: -650 },
    ];
    const postOffset0: LedgerEntry[] = [
      { transactionId: 't3', date: '2026-08-16', payee: 'Kassensturz adjustment', memo: null, delta: -50, balance: 200 },
    ];
    const postOffset50: LedgerEntry[] = [
      { transactionId: 't4', date: '2026-06-01', payee: 'Utilities', memo: null, delta: -80, balance: 120 },
    ];

    getAccountLedger.mockImplementation((_id: string, params: { limit?: number; offset?: number } = {}) => {
      const off = params.offset ?? 0;
      if (!reconciled) {
        return Promise.resolve(
          off === 0 ? { data: preOffset0, meta: meta({ total: 3, offset: 0 }) } : { data: preOffset50, meta: meta({ total: 3, offset: 50 }) },
        );
      }
      return Promise.resolve(
        off === 0 ? { data: postOffset0, meta: meta({ total: 2, offset: 0 }) } : { data: postOffset50, meta: meta({ total: 2, offset: 50 }) },
      );
    });

    // gcTime: 0 so the page-0 query is dropped once unobserved (after Load
    // more moves the active query to offset 50) — the eventual reset back to
    // offset 0 always issues a genuinely fresh fetch, not a stale-then-fresh
    // pair, which keeps this test's assertions unambiguous.
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(<QueryClientProvider client={qc}><LedgerView accountId="a1" /></QueryClientProvider>);

    expect(await screen.findByText('Market')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Rent')).toBeInTheDocument();
    // Both pre-reconcile pages visible together (100 rows' worth in the real app).
    expect(screen.getByText('Market')).toBeInTheDocument();

    await new Promise((resolve) => setTimeout(resolve, 5));
    reconciled = true;
    // Reconcile invalidates the ledger key prefix while the offset-50 page —
    // NOT page 0 — is the mounted/active query.
    await qc.invalidateQueries({ queryKey: ['ledger', 'a1'] });

    // The view restarts at page 0 with fresh data: no gap, no rows left over
    // from either pre-reconcile page, offset math reset to the top.
    await waitFor(() => expect(screen.getByText('Kassensturz adjustment')).toBeInTheDocument());
    expect(screen.queryByText('Market')).not.toBeInTheDocument();
    expect(screen.queryByText('Rent')).not.toBeInTheDocument();

    // Load more still works after the reset.
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Utilities')).toBeInTheDocument();
    expect(screen.getByText('Kassensturz adjustment')).toBeInTheDocument();
  });
});

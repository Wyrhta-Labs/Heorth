import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { Account, Envelope, LedgerEntry, LedgerMeta } from '@/lib/types';
import { ApiError } from '@/api/client';

const useAccounts = vi.fn();
const useEnvelopes = vi.fn();
const useLedger = vi.fn();
const reconcileMutateAsync = vi.fn();

vi.mock('@/hooks/use-feoh', () => ({
  useAccounts: (...args: unknown[]) => useAccounts(...args),
  useEnvelopes: (...args: unknown[]) => useEnvelopes(...args),
  useLedger: (...args: unknown[]) => useLedger(...args),
  useReconcileAccount: () => ({ mutateAsync: reconcileMutateAsync, isPending: false }),
}));

import AccountsPanel from './accounts-panel';

afterEach(() => {
  cleanup();
  useAccounts.mockReset();
  useEnvelopes.mockReset();
  useLedger.mockReset();
  reconcileMutateAsync.mockReset();
});

const checking: Account = {
  id: 'a1', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  name: 'Checking', kind: 'asset', openingBalance: '100',
};
const creditCard: Account = {
  id: 'a2', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  name: 'Credit Card', kind: 'liability', openingBalance: '0',
};
const groceries: Envelope = {
  id: 'e1', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  name: 'Groceries', monthlyBudget: '400', tone: 'sage',
};

const ledgerMeta = (over: Partial<LedgerMeta> = {}): LedgerMeta => ({
  total: 1, limit: 50, offset: 0, openingBalance: 100, endBalance: 250, ...over,
});
const ledgerEntry = (over: Partial<LedgerEntry> = {}): LedgerEntry => ({
  transactionId: 't1', date: '2026-08-01', payee: 'Market', memo: null, delta: 150, balance: 250, ...over,
});

function setup(opts: { accounts?: Account[]; ledger?: { data: LedgerEntry[]; meta: LedgerMeta } } = {}) {
  const accounts = opts.accounts ?? [checking];
  const ledger = opts.ledger ?? { data: [ledgerEntry()], meta: ledgerMeta() };
  useAccounts.mockReturnValue({ data: { data: accounts }, isError: false, isLoading: false });
  useEnvelopes.mockReturnValue({ data: { data: [groceries] }, isError: false, isLoading: false });
  useLedger.mockReturnValue({ data: ledger, isError: false, isLoading: false });
  return { accounts, ledger };
}

describe('AccountsPanel', () => {
  it('lists accounts with the end balance from the ledger meta', () => {
    setup();
    render(<AccountsPanel />);
    expect(screen.getByText('Checking')).toBeInTheDocument();
    expect(screen.getByText('$250.00')).toBeInTheDocument();
  });

  it('renders ledger rows when an account is expanded', async () => {
    setup();
    render(<AccountsPanel />);

    fireEvent.click(screen.getByText('Checking'));

    expect(await screen.findByText('Market')).toBeInTheDocument();
    // delta and running balance both render as $150.00 / $250.00.
    expect(screen.getByText('$150.00')).toBeInTheDocument();
    expect(screen.getAllByText('$250.00').length).toBeGreaterThan(0);
  });

  it('requests the header balance with the same params as the ledger view\'s first page, so expanding reuses one cache entry', () => {
    setup();
    render(<AccountsPanel />);

    expect(useLedger).toHaveBeenCalledWith('a1', { limit: 50, offset: 0 });
  });

  it('shows the Kassensturz button only on asset accounts', () => {
    setup({ accounts: [checking, creditCard] });
    render(<AccountsPanel />);
    const reconcileButtons = screen.getAllByRole('button', { name: 'Kassensturz' });
    expect(reconcileButtons).toHaveLength(1);
  });

  it('reconciles an account and shows "no difference" when the counts match', async () => {
    setup();
    reconcileMutateAsync.mockResolvedValue({ data: { difference: 0, transaction: null } });
    render(<AccountsPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Kassensturz' }));
    fireEvent.change(await screen.findByLabelText('Counted amount'), { target: { value: '250' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record' }));

    await waitFor(() => expect(reconcileMutateAsync).toHaveBeenCalledWith({
      id: 'a1',
      input: { countedBalance: 250, date: expect.any(String), envelopeId: '', memo: null },
    }));
    expect(await screen.findByText('Counts match - nothing to book.')).toBeInTheDocument();
  });

  it('shows the later-transactions message on a 409 error', async () => {
    setup();
    reconcileMutateAsync.mockRejectedValue(new ApiError(409, 'LATER_TRANSACTIONS_EXIST', 'later'));
    render(<AccountsPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Kassensturz' }));
    fireEvent.change(await screen.findByLabelText('Counted amount'), { target: { value: '250' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record' }));

    expect(await screen.findByText("There are newer transactions - reconcile with today's date.")).toBeInTheDocument();
  });
});

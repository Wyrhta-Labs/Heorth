import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { ImportedTransaction, Envelope, Account, ImportAccountMapping } from '@/lib/types';

const useImportInbox = vi.fn();
const useImportAccounts = vi.fn();
const confirm = vi.fn();
const dismiss = vi.fn();
vi.mock('@/hooks/use-feoh-import', () => ({
  useImportInbox: (...a: unknown[]) => useImportInbox(...a),
  useImportAccounts: () => useImportAccounts(),
  useConfirmInboxRow: () => ({ mutateAsync: confirm, isPending: false }),
  useDismissInboxRow: () => ({ mutateAsync: dismiss, isPending: false }),
}));
const useEnvelopes = vi.fn();
const useAccounts = vi.fn();
vi.mock('@/hooks/use-feoh', () => ({
  useEnvelopes: () => useEnvelopes(),
  useAccounts: () => useAccounts(),
}));
const toast = vi.fn();
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));

import ImportInbox from './import-inbox';

const groceries: Envelope = { id: 'e1', createdAt: '', updatedAt: '', name: 'Groceries', monthlyBudget: '400', tone: null };
const joint: Account = { id: 'a1', createdAt: '', updatedAt: '', name: 'Joint', kind: 'asset', openingBalance: '0' };
const mapping: ImportAccountMapping = { id: 'm1', createdAt: '', updatedAt: '', sourceAccountId: '7', accountId: 'a1' };
const row = (over: Partial<ImportedTransaction> = {}): ImportedTransaction => ({
  id: 'r1', createdAt: '', updatedAt: '', sourceId: '101:1', sourceAccountId: '7', date: '2026-09-01',
  payee: 'REWE', memo: 'REWE SAGT DANKE', amount: '42.10', currency: 'EUR', direction: 'out', status: 'pending',
  envelopeId: null, transactionId: null, appliedRuleId: null, ...over,
});
const list = (rows: ImportedTransaction[]) => ({ data: { data: rows, meta: { total: rows.length, limit: 50, offset: 0 } }, isLoading: false, isError: false });

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function arrange(rows: ImportedTransaction[], mappings: ImportAccountMapping[] = [mapping]) {
  useImportInbox.mockReturnValue(list(rows));
  useImportAccounts.mockReturnValue({ data: { data: mappings } });
  useEnvelopes.mockReturnValue({ data: { data: [groceries] } });
  useAccounts.mockReturnValue({ data: { data: [joint] } });
}

describe('ImportInbox', () => {
  it('shows the empty state', () => {
    arrange([]);
    render(<ImportInbox householdCurrency="EUR" />);
    expect(screen.getByText('Nothing waiting.')).toBeInTheDocument();
  });

  it('books a mapped line with the chosen envelope', async () => {
    arrange([row()]);
    confirm.mockResolvedValue({});
    render(<ImportInbox householdCurrency="EUR" />);
    expect(screen.getByText('REWE')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Envelope'), { target: { value: 'e1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Book' }));
    await waitFor(() => expect(confirm).toHaveBeenCalledWith({ id: 'r1', input: { envelopeId: 'e1' } }));
  });

  it('asks for a Feoh account when the source account is unmapped and sends it', async () => {
    arrange([row({ sourceAccountId: '99' })], []);
    confirm.mockResolvedValue({});
    render(<ImportInbox householdCurrency="EUR" />);
    expect(screen.getByText(/not mapped/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Envelope'), { target: { value: 'e1' } });
    fireEvent.change(screen.getByLabelText('Account'), { target: { value: 'a1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Book' }));
    await waitFor(() => expect(confirm).toHaveBeenCalledWith({ id: 'r1', input: { envelopeId: 'e1', accountId: 'a1' } }));
  });

  it('cannot book a foreign-currency line, but can dismiss it', async () => {
    arrange([row({ currency: 'USD' })]);
    dismiss.mockResolvedValue({});
    render(<ImportInbox householdCurrency="EUR" />);
    expect(screen.getByText(/cannot be booked/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Book' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(dismiss).toHaveBeenCalledWith('r1'));
  });

  it('surfaces a dismiss failure as a toast', async () => {
    arrange([row()]);
    dismiss.mockRejectedValue(new Error('nope'));
    render(<ImportInbox householdCurrency="EUR" />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('nope', 'error'));
  });

  it('judges "foreign" against the household currency it is given, not EUR', () => {
    arrange([row({ currency: 'CHF' })]);
    render(<ImportInbox householdCurrency="CHF" />);
    expect(screen.queryByText(/cannot be booked/)).not.toBeInTheDocument();
    expect(screen.getByText(/CHF/)).toBeInTheDocument(); // the amount renders in the row's own currency
  });
});

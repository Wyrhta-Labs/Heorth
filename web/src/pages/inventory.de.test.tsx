import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '@/i18n';
import type { InventoryItem, Transaction, OccurrenceEntry, Account, Envelope, LedgerEntry, LedgerMeta } from '@/lib/types';

// --- Inventory page mocks (mirrors inventory.test.tsx) ---
const listItems = vi.fn();
const createItem = vi.fn();
const getItem = vi.fn();
const updateItem = vi.fn();
const decommissionItem = vi.fn();
const deleteItem = vi.fn();

vi.mock('@/api/inventory', () => ({
  listItems: (...args: unknown[]) => listItems(...args),
  createItem: (...args: unknown[]) => createItem(...args),
  getItem: (...args: unknown[]) => getItem(...args),
  updateItem: (...args: unknown[]) => updateItem(...args),
  decommissionItem: (...args: unknown[]) => decommissionItem(...args),
  deleteItem: (...args: unknown[]) => deleteItem(...args),
}));

const getItemCosts = vi.fn();
const createItemCost = vi.fn();
const deleteItemCost = vi.fn();
const listTransactions = vi.fn();
const listOccurrences = vi.fn();
const linkOccurrence = vi.fn();
const skipOccurrence = vi.fn();
const unskipOccurrence = vi.fn();
const unlinkOccurrence = vi.fn();
const overrideOccurrence = vi.fn();
const listAccounts = vi.fn();
const listEnvelopes = vi.fn();
const getAccountLedger = vi.fn();
const reconcileAccount = vi.fn();

vi.mock('@/api/feoh', () => ({
  getItemCosts: (...args: unknown[]) => getItemCosts(...args),
  createItemCost: (...args: unknown[]) => createItemCost(...args),
  deleteItemCost: (...args: unknown[]) => deleteItemCost(...args),
  listTransactions: (...args: unknown[]) => listTransactions(...args),
  listOccurrences: (...args: unknown[]) => listOccurrences(...args),
  linkOccurrence: (...args: unknown[]) => linkOccurrence(...args),
  skipOccurrence: (...args: unknown[]) => skipOccurrence(...args),
  unskipOccurrence: (...args: unknown[]) => unskipOccurrence(...args),
  unlinkOccurrence: (...args: unknown[]) => unlinkOccurrence(...args),
  overrideOccurrence: (...args: unknown[]) => overrideOccurrence(...args),
  listAccounts: (...args: unknown[]) => listAccounts(...args),
  listEnvelopes: (...args: unknown[]) => listEnvelopes(...args),
  getAccountLedger: (...args: unknown[]) => getAccountLedger(...args),
  reconcileAccount: (...args: unknown[]) => reconcileAccount(...args),
}));

const toast = vi.fn();
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));

import InventoryPage from './inventory';
import OccurrenceStrip from '@/components/feoh/occurrence-strip';
import AccountsPanel from '@/components/feoh/accounts-panel';

beforeEach(async () => {
  await i18n.changeLanguage('de');
  // ItemDetail/DecommissionDialog always call useTransactions() for the "link
  // sale" picker, even before an item is selected.
  listTransactions.mockResolvedValue({ data: [], meta: { total: 0 } });
});

afterEach(async () => {
  cleanup();
  listItems.mockReset();
  createItem.mockReset();
  getItem.mockReset();
  updateItem.mockReset();
  decommissionItem.mockReset();
  deleteItem.mockReset();
  getItemCosts.mockReset();
  createItemCost.mockReset();
  deleteItemCost.mockReset();
  listTransactions.mockReset();
  listOccurrences.mockReset();
  linkOccurrence.mockReset();
  skipOccurrence.mockReset();
  unskipOccurrence.mockReset();
  unlinkOccurrence.mockReset();
  overrideOccurrence.mockReset();
  listAccounts.mockReset();
  listEnvelopes.mockReset();
  getAccountLedger.mockReset();
  reconcileAccount.mockReset();
  toast.mockReset();
  await i18n.changeLanguage('en');
});

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const item1: InventoryItem = {
  id: 'i1',
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
  name: 'Drill',
  category: 'Tools',
  manufacturer: null,
  model: null,
  serialNumber: null,
  location: 'Garage',
  notes: null,
  warrantyUntil: null,
  purchasePrice: '120',
  purchaseDate: '2025-01-01',
  decommissionedAt: null,
  decommissionReason: null,
  disposalProceeds: null,
};

describe('InventoryPage in German', () => {
  it('renders the page title, add-item button, and item detail (decommission action, TCO) in German', async () => {
    listItems.mockResolvedValue({ data: [item1], meta: { total: 1 } });
    getItemCosts.mockResolvedValue({
      data: {
        item: item1,
        links: [],
        recurringBills: [],
        totals: { capital: 120, tier2: 0, recurring: 0, proceeds: 0, total: 120, perYear: 40, lifetimeDays: 1095 },
      },
    });
    renderWithClient(<InventoryPage />);

    expect(screen.getByText('Inventar')).toBeInTheDocument();
    expect(screen.getByText('Gegenstand hinzufügen')).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText('Drill')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Drill'));

    await waitFor(() => expect(getItemCosts).toHaveBeenCalledWith('i1'));
    expect(screen.getByRole('button', { name: 'Ausmustern' })).toBeInTheDocument();
    expect(screen.getByText('Betriebskosten')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Pro Jahr')).toBeInTheDocument());
  });
});

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

describe('OccurrenceStrip in German', () => {
  it('renders the overdue status chip in German', async () => {
    listOccurrences.mockResolvedValue({ data: [occ({ status: 'overdue' })] });
    renderWithClient(<OccurrenceStrip billId="b1" />);

    expect(await screen.findByText('Überfällig')).toBeInTheDocument();
  });
});

const checking: Account = {
  id: 'a1', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  name: 'Checking', kind: 'asset', openingBalance: '100',
};
const groceries: Envelope = {
  id: 'e1', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  name: 'Groceries', monthlyBudget: '400', tone: 'sage',
};
const ledgerMeta: LedgerMeta = { total: 1, limit: 50, offset: 0, openingBalance: 100, endBalance: 250 };
const ledgerEntry: LedgerEntry = { transactionId: 't1', date: '2026-08-01', payee: 'Market', memo: null, delta: 150, balance: 250 };

describe('AccountsPanel in German', () => {
  it('renders the Kassensturz button in German', async () => {
    listAccounts.mockResolvedValue({ data: [checking] });
    listEnvelopes.mockResolvedValue({ data: [groceries] });
    getAccountLedger.mockResolvedValue({ data: [ledgerEntry], meta: ledgerMeta });

    renderWithClient(<AccountsPanel />);
    expect(await screen.findByRole('button', { name: 'Kassensturz' })).toBeInTheDocument();
  });
});

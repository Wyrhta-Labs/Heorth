// The browser runs in UTC; the household lives in Pacific/Auckland. 13:00Z on
// Fri 31 Jul is 01:00 Sat 1 Aug there: the browser is in July, the household in
// August. Set before any import touches Date/Intl.
process.env.TZ = 'UTC';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { Account, Envelope, EthelAsset } from '@/lib/types';

const summaryMonths: string[] = [];
const okList = { data: { data: [], meta: { total: 0 } }, isError: false, isLoading: false, refetch: vi.fn() };
const summary = { data: undefined, isError: false, isLoading: false, refetch: vi.fn() };
const mutation = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };

vi.mock('@/hooks/use-feoh', () => ({
  useSummary: (month: string) => { summaryMonths.push(month); return summary; },
  useEnvelopes: () => okList,
  useAccounts: () => okList,
  useBills: () => okList,
  useRecordTransaction: () => mutation,
  useDeleteBill: () => mutation,
  useImportCsv: () => mutation,
  // BillsList renders OverdueBadge/OccurrenceStrip (occurrence-strip.tsx),
  // which call these hooks even with zero bills.
  useOccurrences: () => okList,
  useTransactions: () => okList,
  useLinkOccurrence: () => mutation,
  useSkipOccurrence: () => mutation,
  useUnskipOccurrence: () => mutation,
  useUnlinkOccurrence: () => mutation,
  useOverrideOccurrence: () => mutation,
  useLedger: () => okList,
  useReconcileAccount: () => mutation,
  useCreateItemCost: () => mutation,
}));
vi.mock('@/hooks/use-feoh-import', () => ({
  useImportStatus: () => ({ data: { data: { enabled: false, currency: 'EUR', pendingCount: 0, feed: null } }, isError: false, isLoading: false }),
  useTriggerSync: () => mutation,
  useImportInbox: () => okList,
  useImportAccounts: () => okList,
  useImportRules: () => okList,
  useConfirmInboxRow: () => mutation,
  useDismissInboxRow: () => mutation,
  useCreateRule: () => mutation,
  useUpdateRule: () => mutation,
  useDeleteRule: () => mutation,
  useUpsertAccountMapping: () => mutation,
  useDeleteAccountMapping: () => mutation,
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

vi.mock('@/hooks/use-household', () => ({
  useHousehold: () => ({ data: { data: { timezone: 'Pacific/Auckland' } }, isError: false }),
}));
vi.mock('@/hooks/use-ethel', () => ({ useDecommissionAsset: () => mutation }));

import FeohPage from './feoh';
import TransactionForm from '@/components/feoh/transaction-form';
import ReconcileDialog from '@/components/feoh/reconcile-dialog';
import DecommissionDialog from '@/components/ethel/decommission-dialog';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-07-31T13:00:00Z'));
  summaryMonths.length = 0;
});
afterEach(() => { vi.useRealTimers(); cleanup(); });

const dateInput = (label: RegExp) => screen.getByLabelText(label) as HTMLInputElement;

describe("finance and asset dates default to the household's today", () => {
  it("FeohPage summarises the household's month", () => {
    render(<FeohPage />);
    expect(summaryMonths.at(-1)).toBe('2026-08');
  });

  it('TransactionForm', () => {
    render(<TransactionForm accounts={[{ id: 'a1' } as Account]} envelopes={[{ id: 'e1' } as Envelope]} onSubmit={async () => {}} onCancel={() => {}} />);
    expect(dateInput(/^date$/i).value).toBe('2026-08-01');
  });

  it('ReconcileDialog', () => {
    render(<ReconcileDialog open onOpenChange={() => {}} accountId="a1" />);
    expect(dateInput(/^date$/i).value).toBe('2026-08-01');
  });

  it('DecommissionDialog', () => {
    render(<DecommissionDialog asset={{ id: 'x1', name: 'Kettle' } as EthelAsset} onClose={() => {}} />);
    expect(dateInput(/date/i).value).toBe('2026-08-01');
  });
});

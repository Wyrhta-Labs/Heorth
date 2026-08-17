import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

const okList = { data: { data: [], meta: { total: 0 } }, isError: false, isLoading: false, refetch: vi.fn() };
const summary = { data: undefined, isError: false, isLoading: false, refetch: vi.fn() };
const mutation = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };

vi.mock('@/hooks/use-feoh', () => ({
  useSummary: () => summary,
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
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import FeohPage from './feoh';

afterEach(() => {
  cleanup();
});

describe('FeohPage', () => {
  it('renders the normal finance UI', () => {
    render(<FeohPage />);
    expect(screen.getByText('New transaction')).toBeInTheDocument();
    expect(screen.queryByText('Feature not enabled')).not.toBeInTheDocument();
  });
});

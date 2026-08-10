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
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

const useFeaturesMock = vi.fn();
vi.mock('@/hooks/use-features', () => ({
  useFeatures: () => useFeaturesMock(),
}));

import FeohPage from './feoh';

afterEach(() => {
  cleanup();
  useFeaturesMock.mockReset();
});

describe('FeohPage feature gating', () => {
  it('renders the unavailable card when finance is disabled', () => {
    useFeaturesMock.mockReturnValue({ data: { data: { finance: false } }, isError: false });
    render(<FeohPage />);
    expect(screen.getByText('Feature not enabled')).toBeInTheDocument();
    expect(screen.getByText('Finance is not enabled on this server.')).toBeInTheDocument();
    expect(screen.queryByText('New transaction')).not.toBeInTheDocument();
  });

  it('renders the normal finance UI when finance is enabled', () => {
    useFeaturesMock.mockReturnValue({ data: { data: { finance: true } }, isError: false });
    render(<FeohPage />);
    expect(screen.getByText('New transaction')).toBeInTheDocument();
    expect(screen.queryByText('Feature not enabled')).not.toBeInTheDocument();
  });

  it('treats a failed features fetch as finance disabled', () => {
    useFeaturesMock.mockReturnValue({ data: undefined, isError: true });
    render(<FeohPage />);
    expect(screen.getByText('Feature not enabled')).toBeInTheDocument();
  });
});

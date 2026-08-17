import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/api/feoh', () => ({
  reconcileAccount: vi.fn(() => Promise.resolve({ data: { difference: 10, transaction: null } })),
}));

import { useReconcileAccount } from './use-feoh';

describe('useReconcileAccount', () => {
  it('invalidates the ledger, transactions, AND month-summary query keys on success (a booked difference posts to an envelope)', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useReconcileAccount(), { wrapper });
    await result.current.mutateAsync({
      id: 'a1',
      input: { countedBalance: 250, date: '2026-08-16', envelopeId: 'e1', memo: null },
    });

    await waitFor(() => {
      const keys = spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
      expect(keys).toContainEqual(['ledger', 'a1']);
      expect(keys).toContainEqual(['transactions']);
      expect(keys).toContainEqual(['summary']);
    });
  });
});

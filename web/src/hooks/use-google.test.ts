import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const useQueryMock = vi.fn();
vi.mock('@/api/m365', () => ({ getIntegrationsStatus: vi.fn() }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => useQueryMock() }));

const { useGoogleProviderStatus } = await import('./use-google');

const status = (data: Record<string, unknown>) => ({
  data: { data: { myConnections: [], feeds: [], householdListDesignated: false, householdCalendar: null, ...data } },
  error: null,
  isLoading: false,
});

beforeEach(() => { vi.clearAllMocks(); });

describe('useGoogleProviderStatus', () => {
  it('reports unavailable when google is not registered', () => {
    useQueryMock.mockReturnValue(status({ providers: ['m365'] }));
    const { result } = renderHook(() => useGoogleProviderStatus());
    expect(result.current.state).toBe('unavailable');
  });

  it('reports the google connection, not an m365 one', () => {
    useQueryMock.mockReturnValue(status({
      providers: ['m365', 'google'],
      myConnections: [
        { provider: 'm365', memberId: 'm', accountLabel: 'anna@contoso.test', status: 'active', lastRefreshSuccessAt: null, lastRefreshError: null },
        { provider: 'google', memberId: 'm', accountLabel: 'anna@gmail.test', status: 'active', lastRefreshSuccessAt: null, lastRefreshError: null },
      ],
    }));

    const { result } = renderHook(() => useGoogleProviderStatus());

    expect(result.current.state).toBe('connected');
    expect(result.current.connection!.accountLabel).toBe('anna@gmail.test');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { ApiError } from '@/api/client';

const useQueryMock = vi.fn();
vi.mock('@/api/m365', () => ({ getIntegrationsStatus: vi.fn() }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => useQueryMock() }));

const { useProviderStatus } = await import('./use-m365');

const status = (data: Record<string, unknown>) => ({
  data: { data: { myConnections: [], feeds: [], householdListDesignated: false, householdCalendar: null, ...data } },
  error: null,
  isLoading: false,
});

beforeEach(() => { vi.clearAllMocks(); });

describe('useProviderStatus', () => {
  it('maps a 404 ApiError to "unavailable" without reporting it as an error', () => {
    useQueryMock.mockReturnValue({
      data: undefined,
      error: new ApiError(404, 'NOT_FOUND', ''),
      isLoading: false,
    });

    const { result } = renderHook(() => useProviderStatus('m365'));

    expect(result.current.state).toBe('unavailable');
    expect(result.current.connection).toBeNull();
  });

  it('reports unavailable when the provider is not registered', () => {
    useQueryMock.mockReturnValue(status({ providers: ['m365'] }));
    const { result } = renderHook(() => useProviderStatus('google'));
    expect(result.current.state).toBe('unavailable');
  });

  it('reports disconnected when registered but the member has no connection', () => {
    useQueryMock.mockReturnValue(status({ providers: ['google'] }));
    const { result } = renderHook(() => useProviderStatus('google'));
    expect(result.current.state).toBe('disconnected');
    expect(result.current.connection).toBeNull();
  });

  it('maps a 200 with providers: [] to "unavailable", not "disconnected"', () => {
    // The status endpoint is provider-neutral: a disabled integration no
    // longer 404s, it returns 200 with an empty provider list. Misreading
    // this as "disconnected" shows a Connect button that 404s when pressed.
    useQueryMock.mockReturnValue(status({ providers: [] }));

    const { result } = renderHook(() => useProviderStatus('m365'));

    expect(result.current.state).toBe('unavailable');
    expect(result.current.connection).toBeNull();
  });

  it('maps an active connection to "connected", using provider-neutral field names', () => {
    useQueryMock.mockReturnValue(status({
      providers: ['m365'],
      myConnections: [
        { provider: 'm365', memberId: 'm1', accountLabel: 'anna@example.com', status: 'active', lastRefreshSuccessAt: '2026-08-01T00:00:00Z', lastRefreshError: null },
      ],
    }));

    const { result } = renderHook(() => useProviderStatus('m365'));

    expect(result.current.state).toBe('connected');
    expect(result.current.connection).toEqual({
      memberId: 'm1',
      accountLabel: 'anna@example.com',
      lastSuccessAt: '2026-08-01T00:00:00Z',
      lastError: null,
    });
  });

  it('maps a non-active connection status to "needs_reauth"', () => {
    useQueryMock.mockReturnValue(status({
      providers: ['m365'],
      myConnections: [
        { provider: 'm365', memberId: 'm1', accountLabel: 'anna@example.com', status: 'error', lastRefreshSuccessAt: null, lastRefreshError: 'invalid_grant' },
      ],
    }));

    const { result } = renderHook(() => useProviderStatus('m365'));

    expect(result.current.state).toBe('needs_reauth');
    expect(result.current.connection).toEqual({
      memberId: 'm1',
      accountLabel: 'anna@example.com',
      lastSuccessAt: null,
      lastError: 'invalid_grant',
    });
  });

  it('picks the connection belonging to ITS OWN provider, not the first one', () => {
    useQueryMock.mockReturnValue(status({
      providers: ['m365', 'google'],
      myConnections: [
        { provider: 'm365', memberId: 'm', accountLabel: 'anna@contoso.test', status: 'active', lastRefreshSuccessAt: null, lastRefreshError: null },
        { provider: 'google', memberId: 'm', accountLabel: 'anna@gmail.test', status: 'needs_reauth', lastRefreshSuccessAt: null, lastRefreshError: 'expired' },
      ],
    }));

    const { result } = renderHook(() => useProviderStatus('google'));

    // The old implementation read `data.connection` — "the first non-null
    // across providers" — which would return the M365 row here.
    expect(result.current.connection!.accountLabel).toBe('anna@gmail.test');
    expect(result.current.state).toBe('needs_reauth');
  });

  it('gives the 404 precedence over an undefined data payload', () => {
    useQueryMock.mockReturnValue({
      data: undefined,
      error: new ApiError(404, 'NOT_FOUND', ''),
      isLoading: false,
    });

    const { result } = renderHook(() => useProviderStatus('m365'));

    expect(result.current.state).toBe('unavailable');
  });
});

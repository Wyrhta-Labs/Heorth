import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { ApiError } from '@/api/client';

const useQueryMock = vi.fn();
vi.mock('@/api/m365', () => ({ getM365Status: vi.fn() }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => useQueryMock() }));

const { useM365ProviderStatus } = await import('./use-m365');

describe('useM365ProviderStatus', () => {
  it('maps a 404 ApiError to "unavailable" without reporting it as an error', () => {
    useQueryMock.mockReturnValue({
      data: undefined,
      error: new ApiError(404, 'NOT_FOUND', ''),
      isLoading: false,
    });

    const { result } = renderHook(() => useM365ProviderStatus());

    expect(result.current.state).toBe('unavailable');
    expect(result.current.connection).toBeNull();
  });

  it('maps no connection to "disconnected"', () => {
    useQueryMock.mockReturnValue({
      data: { data: { connection: null, feeds: [] } },
      error: null,
      isLoading: false,
    });

    const { result } = renderHook(() => useM365ProviderStatus());

    expect(result.current.state).toBe('disconnected');
    expect(result.current.connection).toBeNull();
  });

  it('maps an active connection to "connected", using provider-neutral field names', () => {
    useQueryMock.mockReturnValue({
      data: {
        data: {
          feeds: [],
          connection: {
            memberId: 'm1',
            accountUpn: 'anna@example.com',
            status: 'active',
            lastRefreshSuccessAt: '2026-08-01T00:00:00Z',
            lastRefreshError: null,
          },
        },
      },
      error: null,
      isLoading: false,
    });

    const { result } = renderHook(() => useM365ProviderStatus());

    expect(result.current.state).toBe('connected');
    expect(result.current.connection).toEqual({
      memberId: 'm1',
      accountLabel: 'anna@example.com',
      lastSuccessAt: '2026-08-01T00:00:00Z',
      lastError: null,
    });
  });

  it('maps a non-active connection status to "needs_reauth"', () => {
    useQueryMock.mockReturnValue({
      data: {
        data: {
          feeds: [],
          connection: {
            memberId: 'm1',
            accountUpn: 'anna@example.com',
            status: 'error',
            lastRefreshSuccessAt: null,
            lastRefreshError: 'invalid_grant',
          },
        },
      },
      error: null,
      isLoading: false,
    });

    const { result } = renderHook(() => useM365ProviderStatus());

    expect(result.current.state).toBe('needs_reauth');
    expect(result.current.connection).toEqual({
      memberId: 'm1',
      accountLabel: 'anna@example.com',
      lastSuccessAt: null,
      lastError: 'invalid_grant',
    });
  });

  it('gives the 404 precedence over an undefined data payload', () => {
    useQueryMock.mockReturnValue({
      data: undefined,
      error: new ApiError(404, 'NOT_FOUND', ''),
      isLoading: false,
    });

    const { result } = renderHook(() => useM365ProviderStatus());

    expect(result.current.state).toBe('unavailable');
  });
});

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
      data: { data: { connection: null, feeds: [], providers: ['m365'] } },
      error: null,
      isLoading: false,
    });

    const { result } = renderHook(() => useM365ProviderStatus());

    expect(result.current.state).toBe('disconnected');
    expect(result.current.connection).toBeNull();
  });

  it('maps a 200 with providers: [] to "unavailable", not "disconnected"', () => {
    // The status endpoint is provider-neutral: a disabled integration no
    // longer 404s, it returns 200 with an empty provider list. Misreading
    // this as "disconnected" shows a Connect button that 404s when pressed.
    useQueryMock.mockReturnValue({
      data: { data: { connection: null, feeds: [], providers: [] } },
      error: null,
      isLoading: false,
    });

    const { result } = renderHook(() => useM365ProviderStatus());

    expect(result.current.state).toBe('unavailable');
    expect(result.current.connection).toBeNull();
  });

  it('maps an active connection to "connected", using provider-neutral field names', () => {
    useQueryMock.mockReturnValue({
      data: {
        data: {
          feeds: [],
          providers: ['m365'],
          connection: {
            memberId: 'm1',
            accountLabel: 'anna@example.com',
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
          providers: ['m365'],
          connection: {
            memberId: 'm1',
            accountLabel: 'anna@example.com',
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

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ProviderCard from './provider-card';
import type { ConnectionProvider, ProviderState, ProviderConnection } from '@/lib/providers';
import { Plug } from 'lucide-react';
import { ApiError } from '@/api/client';

const toast = vi.fn();
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));

afterEach(() => { cleanup(); toast.mockClear(); });

const getConnectUrl = vi.fn();
const disconnect = vi.fn();

function providerIn(state: ProviderState, connection: ProviderConnection | null = null): ConnectionProvider {
  return {
    id: 'm365', nameKey: 'connections.m365.name', descriptionKey: 'connections.m365.description',
    capabilities: ['calendar', 'tasks'], icon: Plug,
    api: {
      useStatus: () => ({ state, connection, isLoading: false }),
      getConnectUrl, disconnect,
    },
  };
}

// ProviderCard calls useQueryClient() (to invalidate the M365 status query on
// disconnect), so it needs a QueryClientProvider ancestor — the brief's test
// snippet predates that wiring and omitted it.
function renderCard(provider: ConnectionProvider) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ProviderCard provider={provider} />
    </QueryClientProvider>,
  );
}

describe('ProviderCard', () => {
  it('offers no action when the integration is unavailable', () => {
    renderCard(providerIn('unavailable'));
    expect(screen.queryByRole('button', { name: /connect/i })).not.toBeInTheDocument();
  });

  it('offers Connect when disconnected', () => {
    renderCard(providerIn('disconnected'));
    expect(screen.getByRole('button', { name: /connect/i })).toBeInTheDocument();
  });

  it('shows the account and offers Disconnect when connected', () => {
    renderCard(providerIn('connected', {
      memberId: 'b', accountLabel: 'anna@example.com',
      lastSuccessAt: '2026-08-04T10:00:00Z', lastError: null,
    }));
    expect(screen.getByText('anna@example.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /disconnect/i })).toBeInTheDocument();
  });

  it('renders lastSuccessAt (last refresh) when connected', () => {
    renderCard(providerIn('connected', {
      memberId: 'b', accountLabel: 'anna@example.com',
      lastSuccessAt: '2026-08-04T10:00:00Z', lastError: null,
    }));
    expect(screen.getByText(/last refreshed/i)).toBeInTheDocument();
  });

  it('renders no last-refresh line when lastSuccessAt is null', () => {
    renderCard(providerIn('connected', {
      memberId: 'b', accountLabel: 'anna@example.com',
      lastSuccessAt: null, lastError: null,
    }));
    expect(screen.queryByText(/last refreshed/i)).not.toBeInTheDocument();
  });

  it('offers Reconnect and shows the error when re-auth is needed', () => {
    renderCard(providerIn('needs_reauth', {
      memberId: 'b', accountLabel: 'anna@example.com',
      lastSuccessAt: null, lastError: 'invalid_grant',
    }));
    expect(screen.getByRole('button', { name: /reconnect/i })).toBeInTheDocument();
    expect(screen.getByText(/invalid_grant/)).toBeInTheDocument();
  });

  it('navigates to the consent URL on Connect', async () => {
    getConnectUrl.mockResolvedValue('https://login.microsoftonline.com/authorize?x=1');
    const locationSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      value: {
        get href() { return ''; },
        set href(url: string) { locationSpy(url); },
      },
      writable: true,
      configurable: true,
    });

    renderCard(providerIn('disconnected'));
    fireEvent.click(screen.getByRole('button', { name: /connect/i }));

    await waitFor(() => expect(getConnectUrl).toHaveBeenCalled());
    await waitFor(() => expect(locationSpy).toHaveBeenCalledWith('https://login.microsoftonline.com/authorize?x=1'));
  });

  it('toasts the specific message when the server rejects the maintenance admin', async () => {
    getConnectUrl.mockRejectedValue(new ApiError(403, 'ADMIN_NOT_A_MEMBER', 'nope'));

    renderCard(providerIn('disconnected'));
    fireEvent.click(screen.getByRole('button', { name: /connect/i }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith(
      expect.stringContaining('maintenance admin'),
      'error',
    ));
  });

  it('falls back to the generic connect-failed toast for other errors', async () => {
    getConnectUrl.mockRejectedValue(new Error('network down'));

    renderCard(providerIn('disconnected'));
    fireEvent.click(screen.getByRole('button', { name: /connect/i }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.any(String), 'error'));
    expect(toast.mock.calls[0][0]).not.toContain('maintenance admin');
  });
});

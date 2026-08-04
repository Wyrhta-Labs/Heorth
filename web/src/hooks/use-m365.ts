import { useQuery } from '@tanstack/react-query';
import { QUERY_KEYS } from '@/lib/constants';
import { getM365Status } from '@/api/m365';
import type { M365Connection } from '@/api/m365';
import { ApiError } from '@/api/client';
import type { FeedStatus } from '@/lib/hearth';

const M365_FEED_STATUS_KEY = ['m365', 'feedStatus'] as const;

/**
 * Per-feed M365 sync health for the Hearth staleness badges. Polls (default 60s)
 * and refetches on reconnect. When the integration is disabled the endpoint
 * 404s; we swallow that to an empty feed list (nothing to grey) rather than
 * treat it as an error on the wall. Retry is disabled so a disabled deployment
 * doesn't hammer the endpoint.
 *
 * NOTE: named `FeedStatus` (not `useM365Status`) to avoid colliding with the
 * raw status query below (Task 10) — this one unwraps to `FeedStatus[]` and
 * swallows errors; that one exposes the full envelope for the connection UI.
 */
export function useM365FeedStatus(refetchInterval = 60_000) {
  return useQuery<FeedStatus[]>({
    queryKey: M365_FEED_STATUS_KEY,
    queryFn: async () => {
      try {
        const res = await getM365Status();
        return res.data.feeds ?? [];
      } catch {
        return [];
      }
    },
    refetchInterval,
    refetchOnReconnect: true,
    retry: false,
    gcTime: 10 * 60_000,
  });
}

export type ProviderState = 'unavailable' | 'disconnected' | 'connected' | 'needs_reauth';

/** Raw query — the admin panel needs `connections` and `feeds` too. */
export function useM365Status() {
  return useQuery({
    queryKey: QUERY_KEYS.m365Status,
    queryFn: getM365Status,
    retry: false,
  });
}

/**
 * Derived per-member view used by the provider registry. A 404 means the
 * integration is disabled server-side (the routes are not mounted at all).
 * That is "not available", never an error worth a toast.
 */
export function useM365ProviderStatus(): {
  state: ProviderState;
  connection: M365Connection | null;
  isLoading: boolean;
} {
  const query = useM365Status();

  const notMounted = query.error instanceof ApiError && query.error.status === 404;
  const connection = query.data?.data.connection ?? null;

  const state: ProviderState = notMounted
    ? 'unavailable'
    : !connection
      ? 'disconnected'
      : connection.status === 'active'
        ? 'connected'
        : 'needs_reauth';

  return { state, connection, isLoading: query.isLoading };
}

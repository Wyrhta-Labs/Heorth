import { useQuery } from '@tanstack/react-query';
import { QUERY_KEYS } from '@/lib/constants';
import { getIntegrationsStatus } from '@/api/m365';
import { ApiError } from '@/api/client';
import type { FeedStatus } from '@/lib/hearth';
// `ProviderState`/`ProviderConnection` are provider-neutral and live in
// providers.ts alongside the rest of the registry contract; providers.ts in
// turn imports the *value* `useProviderStatus` from this module. Both
// imports here are type-only, so there is no runtime cycle.
import type { ProviderState, ProviderConnection } from '@/lib/providers';

const INTEGRATIONS_FEED_STATUS_KEY = ['integrations', 'feedStatus'] as const;

/**
 * Per-feed sync health for the Hearth staleness badges. Polls (default 60s)
 * and refetches on reconnect. The endpoint is provider-neutral and returns 200
 * with an empty feed list when no integration is configured; any thrown error
 * (network, unexpected 4xx/5xx) is also swallowed to an empty feed list
 * (nothing to grey) rather than treated as an error on the wall. Retry is
 * disabled so a disabled deployment doesn't hammer the endpoint.
 *
 * NOTE: named `FeedStatus` (not `Status`) to avoid colliding with the raw
 * status query below — this one unwraps to `FeedStatus[]` and swallows
 * errors; that one exposes the full envelope for the connection UI.
 */
export function useIntegrationsFeedStatus(refetchInterval = 60_000) {
  return useQuery<FeedStatus[]>({
    queryKey: INTEGRATIONS_FEED_STATUS_KEY,
    queryFn: async () => {
      try {
        const res = await getIntegrationsStatus();
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

/** Raw query — the admin panel needs `connections` and `feeds` too. */
export function useIntegrationsStatus() {
  return useQuery({
    queryKey: QUERY_KEYS.integrationsStatus,
    queryFn: getIntegrationsStatus,
    retry: false,
  });
}

/**
 * Derived per-member view for ONE provider, used by the provider registry.
 *
 * Parameterised rather than duplicated per provider: the previous version read
 * `data.connection`, "the first non-null across providers", which would have
 * rendered a Google connection on the Microsoft card the moment a second
 * provider existed. It now selects from `myConnections` BY PROVIDER.
 *
 * A provider missing from `providers[]` is `unavailable`, not an error: the
 * endpoint is provider-neutral and 200s with `providers: []` when nothing is
 * configured.
 */
export function useProviderStatus(providerId: string): {
  state: ProviderState;
  connection: ProviderConnection | null;
  isLoading: boolean;
} {
  const query = useIntegrationsStatus();

  const notMounted =
    (query.error instanceof ApiError && query.error.status === 404) ||
    (query.data !== undefined && !query.data.data.providers.includes(providerId));
  const raw = query.data?.data.myConnections.find((cnx) => cnx.provider === providerId) ?? null;

  // Map the wire shape onto the provider-neutral contract — the rendering
  // component never sees the raw `status` string.
  const connection: ProviderConnection | null = raw
    ? {
        memberId: raw.memberId,
        accountLabel: raw.accountLabel,
        lastSuccessAt: raw.lastRefreshSuccessAt,
        lastError: raw.lastRefreshError,
      }
    : null;

  const state: ProviderState = notMounted
    ? 'unavailable'
    : !raw
      ? 'disconnected'
      : raw.status === 'active'
        ? 'connected'
        : 'needs_reauth';

  return { state, connection, isLoading: query.isLoading };
}

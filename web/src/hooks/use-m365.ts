import { useQuery } from '@tanstack/react-query';
import { getM365Status } from '@/api/m365';
import type { FeedStatus } from '@/lib/hearth';

const M365_STATUS_KEY = ['m365', 'status'] as const;

/**
 * Per-feed M365 sync health for the Hearth staleness badges. Polls (default 60s)
 * and refetches on reconnect. When the integration is disabled the endpoint
 * 404s; we swallow that to an empty feed list (nothing to grey) rather than
 * treat it as an error on the wall. Retry is disabled so a disabled deployment
 * doesn't hammer the endpoint.
 */
export function useM365Status(refetchInterval = 60_000) {
  return useQuery<FeedStatus[]>({
    queryKey: M365_STATUS_KEY,
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

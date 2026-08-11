import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { QUERY_KEYS } from '@/lib/constants';
import * as api from '@/api/kith';

/**
 * Extra react-query options callers (the Hearth wall) can pass. `enabled` is
 * the important one: the query must be fully off — no request, no retries —
 * when the KithLedger integration is disabled server-side or the wall toggle
 * is off, so a missing integration never produces a 404 poll loop.
 */
type QueryOpts = {
  enabled?: boolean;
  refetchInterval?: number;
  gcTime?: number;
  placeholderData?: typeof keepPreviousData;
};

export function useKithReminders(params: api.ListKithRemindersParams, opts: QueryOpts = {}) {
  return useQuery({
    queryKey: [...QUERY_KEYS.kithReminders, params],
    queryFn: () => api.listKithReminders(params),
    ...opts,
  });
}

import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { QUERY_KEYS } from '@/lib/constants';
import * as api from '@/api/auth';
import { listHouseholdKeys, revokeHouseholdKey } from '@/api/household';

// The admin's own keys appear in both lists, so any change refreshes both.
function invalidateKeys(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: QUERY_KEYS.apiKeys });
  void qc.invalidateQueries({ queryKey: QUERY_KEYS.householdKeys });
}

export function useApiKeys() {
  return useQuery({ queryKey: QUERY_KEYS.apiKeys, queryFn: () => api.listApiKeys() });
}
export function useCreateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.createApiKey(name),
    onSuccess: () => invalidateKeys(qc),
  });
}
export function useRevokeApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.revokeApiKey(id),
    onSuccess: () => invalidateKeys(qc),
  });
}
export function useHouseholdKeys() {
  return useQuery({ queryKey: QUERY_KEYS.householdKeys, queryFn: () => listHouseholdKeys() });
}
export function useRevokeHouseholdKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => revokeHouseholdKey(id),
    onSuccess: () => invalidateKeys(qc),
  });
}

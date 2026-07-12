import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { QUERY_KEYS } from '@/lib/constants';
import * as api from '@/api/auth';

export function useApiKeys() {
  return useQuery({ queryKey: QUERY_KEYS.apiKeys, queryFn: () => api.listApiKeys() });
}
export function useCreateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.createApiKey(name),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.apiKeys }),
  });
}
export function useRevokeApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.revokeApiKey(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.apiKeys }),
  });
}

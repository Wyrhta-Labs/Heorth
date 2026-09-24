import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { QUERY_KEYS } from '@/lib/constants';
import { elementKey } from '@/lib/gewrit';
import type { GewritElement, GewritLinkRole } from '@/lib/types';
import * as api from '@/api/gewrit';

export function useElementDocuments(el: GewritElement, enabled: boolean) {
  return useQuery({
    queryKey: QUERY_KEYS.gewritElement(elementKey(el)),
    queryFn: () => api.listDocuments(el),
    enabled,
  });
}

/** Callers debounce; this only refuses queries the server would 400. */
export function useDocumentSearch(q: string) {
  return useQuery({
    queryKey: QUERY_KEYS.gewritSearch(q),
    queryFn: () => api.searchDocuments(q),
    enabled: q.trim().length >= 2,
    retry: false,
  });
}

export function useCreateLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: api.CreateLinkInput) => api.createLink(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.gewrit }),
  });
}

export function useUpdateLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: { role?: GewritLinkRole; note?: string | null } }) => api.updateLink(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.gewrit }),
  });
}

export function useDeleteLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteLink(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.gewrit }),
  });
}

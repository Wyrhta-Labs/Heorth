import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { QUERY_KEYS } from '@/lib/constants';
import * as api from '@/api/ethel';

export function useEthelAssets(params: Parameters<typeof api.listAssets>[0] = {}) {
  return useQuery({ queryKey: [...QUERY_KEYS.ethel, params], queryFn: () => api.listAssets(params) });
}

export function useCreateAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: api.AssetInput) => api.createAsset(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.ethel }),
  });
}

export function useUpdateAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<api.AssetInput> }) => api.updateAsset(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.ethel }),
  });
}

export function useDecommissionAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: api.DecommissionInput }) => api.decommissionAsset(id, input),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: QUERY_KEYS.ethel });
      // Server-side TCO totals (proceeds/total) read `asset.disposalProceeds`,
      // which decommission just set — invalidate itemCosts too so an open
      // detail panel's numbers aren't stale when no transaction was linked
      // (the linked-transaction path also invalidates this key, but that
      // only happens when a transaction was actually picked).
      qc.invalidateQueries({ queryKey: QUERY_KEYS.itemCosts(vars.id) });
    },
  });
}

export function useDeleteAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteAsset(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.ethel }),
  });
}

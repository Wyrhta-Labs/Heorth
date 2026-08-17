import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { QUERY_KEYS } from '@/lib/constants';
import * as api from '@/api/inventory';

export function useInventoryItems(params: Parameters<typeof api.listItems>[0] = {}) {
  return useQuery({ queryKey: [...QUERY_KEYS.inventory, params], queryFn: () => api.listItems(params) });
}

export function useCreateItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: api.ItemInput) => api.createItem(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.inventory }),
  });
}

export function useUpdateItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<api.ItemInput> }) => api.updateItem(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.inventory }),
  });
}

export function useDecommissionItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: api.DecommissionInput }) => api.decommissionItem(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.inventory }),
  });
}

export function useDeleteItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteItem(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.inventory }),
  });
}

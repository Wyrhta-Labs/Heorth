import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { QUERY_KEYS } from '@/lib/constants';
import * as api from '@/api/library';

export function useConnections() {
  return useQuery({ queryKey: QUERY_KEYS.libraryConnections, queryFn: () => api.listConnections() });
}
export function useLibraryItems(params: api.ListItemsParams = {}) {
  return useQuery({ queryKey: [...QUERY_KEYS.libraryItems, params], queryFn: () => api.listItems(params) });
}
export function useSearchLibrary(q: string) {
  return useQuery({ queryKey: [...QUERY_KEYS.libraryItems, 'search', q], queryFn: () => api.searchItems(q), enabled: q.length > 0 });
}
export function useCreateLibraryThing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userid, key }: { userid: string; key: string }) => api.createLibraryThingConnection(userid, key),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.libraryConnections }),
  });
}
export function useSyncConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.syncConnection(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEYS.libraryConnections });
      qc.invalidateQueries({ queryKey: QUERY_KEYS.libraryItems });
    },
  });
}
export function useDeleteConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteConnection(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEYS.libraryConnections });
      qc.invalidateQueries({ queryKey: QUERY_KEYS.libraryItems });
    },
  });
}
export function useImportFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, json }: { id: string; json: unknown }) => api.importLibraryThingFile(id, json),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEYS.libraryConnections });
      qc.invalidateQueries({ queryKey: QUERY_KEYS.libraryItems });
    },
  });
}
export function useStartTraktDevice() {
  return useMutation({ mutationFn: () => api.startTraktDevice() });
}
export function usePollTraktDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (device_code: string) => api.pollTraktDevice(device_code),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.libraryConnections }),
  });
}

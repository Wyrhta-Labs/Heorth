import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { QUERY_KEYS } from '@/lib/constants';
import * as api from '@/api/calendar';

export function useEvents(params: api.ListEventsParams = {}) {
  return useQuery({ queryKey: [...QUERY_KEYS.events, params], queryFn: () => api.listEvents(params) });
}
export function useCreateEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: api.EventInput) => api.createEvent(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.events }),
  });
}
export function useUpdateEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<api.EventInput> }) => api.updateEvent(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.events }),
  });
}
export function useMoveEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, startAt, endAt }: { id: string; startAt: string; endAt?: string }) => api.moveEvent(id, startAt, endAt),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.events }),
  });
}
export function useDeleteEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteEvent(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.events }),
  });
}

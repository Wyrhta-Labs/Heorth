import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { QUERY_KEYS } from '@/lib/constants';
import * as api from '@/api/calendar-allowlist';

export function useAvailableCalendars(enabled: boolean) {
  return useQuery({ queryKey: QUERY_KEYS.calendarList, queryFn: () => api.listCalendars(), enabled });
}

export function useSetCalendarAllowlist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (calendars: Array<{ provider: string; calendarId: string }>) => api.setCalendarAllowlist(calendars),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEYS.calendarList });
    },
  });
}

export function useSetHouseholdCalendar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ provider, calendarId }: { provider: string; calendarId: string }) =>
      api.setHouseholdCalendar(provider, calendarId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEYS.calendarList });
    },
  });
}

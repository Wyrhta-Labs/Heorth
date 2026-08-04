import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { QUERY_KEYS, MAINTENANCE_ADMIN_HANDLE } from '@/lib/constants';
import * as api from '@/api/household';
import { whoami } from '@/api/auth';
import type { Role } from '@/lib/types';

export function useWhoami() {
  return useQuery({ queryKey: QUERY_KEYS.whoami, queryFn: () => whoami() });
}
export function useHousehold() {
  return useQuery({ queryKey: QUERY_KEYS.household, queryFn: () => api.getHousehold() });
}
/**
 * Timezone/locale option lists. Static server-side config, so it is cached for
 * the session rather than refetched with the rest of the household data.
 */
export function useHouseholdOptions() {
  return useQuery({
    queryKey: QUERY_KEYS.householdOptions,
    queryFn: () => api.getHouseholdOptions(),
    staleTime: Infinity,
  });
}
export function useMembers() {
  return useQuery({ queryKey: QUERY_KEYS.members, queryFn: () => api.listMembers() });
}
/**
 * Members for daily business — the maintenance admin excluded.
 *
 * The admin is a maintenance login, not a household person: it may not own or be
 * assigned anything (the server enforces this too). Use this everywhere EXCEPT the
 * household members table and the admin connections overview, which need the raw
 * `useMembers()`.
 *
 * Filters on `handle`, NOT `role`: the quarantine is anchored on the fixed
 * maintenance handle (`MAINTENANCE_ADMIN_HANDLE`), because a real household
 * member can be promoted to admin (`PATCH /members/:id/role`) and remains an
 * ordinary, non-quarantined member who must stay visible here. A `null` handle
 * is never the maintenance admin and must be kept.
 */
export function useHouseholdMembers() {
  const query = useMembers();
  const data = query.data
    ? { ...query.data, data: query.data.data.filter((m) => m.handle !== MAINTENANCE_ADMIN_HANDLE) }
    : undefined;
  return { ...query, data } as typeof query;
}
export function useCreateMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: api.CreateMemberInput) => api.createMember(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.members }),
  });
}
export function useUpdateMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: api.UpdateMemberInput }) => api.updateMember(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.members }),
  });
}
export function useSetMemberRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, role }: { id: string; role: Role }) => api.setMemberRole(id, role),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.members }),
  });
}
export function useDeleteMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteMember(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.members }),
  });
}
export function useUpdateHousehold() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof api.updateHousehold>[0]) => api.updateHousehold(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.household }),
  });
}

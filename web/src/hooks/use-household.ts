import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { QUERY_KEYS } from '@/lib/constants';
import * as api from '@/api/household';
import { whoami } from '@/api/auth';
import type { Role } from '@/lib/types';

export function useWhoami() {
  return useQuery({ queryKey: QUERY_KEYS.whoami, queryFn: () => whoami() });
}
export function useHousehold() {
  return useQuery({ queryKey: QUERY_KEYS.household, queryFn: () => api.getHousehold() });
}
export function useMembers() {
  return useQuery({ queryKey: QUERY_KEYS.members, queryFn: () => api.listMembers() });
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

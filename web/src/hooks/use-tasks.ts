import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { QUERY_KEYS } from '@/lib/constants';
import * as api from '@/api/tasks';

export function useTasks(params: api.ListTasksParams = {}) {
  return useQuery({ queryKey: [...QUERY_KEYS.tasks, params], queryFn: () => api.listTasks(params) });
}

export function useAvailableLists(enabled: boolean) {
  return useQuery({ queryKey: QUERY_KEYS.taskLists, queryFn: () => api.listAvailableLists(), enabled });
}

export function useCompleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, completed }: { id: string; completed: boolean }) => api.completeTask(id, completed),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.tasks }),
  });
}

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { title: string; notes?: string | null; dueAt?: string | null }) => api.createTask(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.tasks }),
  });
}

export function useSetAllowlist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (listIds: string[]) => api.setAllowlist(listIds),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEYS.taskLists });
      qc.invalidateQueries({ queryKey: QUERY_KEYS.tasks });
    },
  });
}

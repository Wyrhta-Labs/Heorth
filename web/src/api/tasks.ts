import { apiGet, apiPost, apiPut, qs } from './client';
import type {
  ListResponse, SingleResponse, Task, AvailableTaskList, TodoAllowlistEntry,
} from '@/lib/types';

export interface ListTasksParams {
  status?: 'open' | 'completed';
  member_id?: string;
  list_id?: string;
  due_from?: string;
  due_to?: string;
}

export function listTasks(params: ListTasksParams = {}): Promise<ListResponse<Task>> {
  return apiGet(`/tasks${qs(params as Record<string, unknown>)}`);
}

export function createTask(input: { title: string; notes?: string | null; dueAt?: string | null }): Promise<SingleResponse<Task>> {
  return apiPost('/tasks', input);
}

export function completeTask(id: string, completed: boolean): Promise<SingleResponse<Task>> {
  return apiPost(`/tasks/${id}/complete`, { completed });
}

export function listAvailableLists(): Promise<SingleResponse<AvailableTaskList[]>> {
  return apiGet('/tasks/lists');
}

export function getAllowlist(): Promise<SingleResponse<TodoAllowlistEntry[]>> {
  return apiGet('/tasks/allowlist');
}

export function setAllowlist(listIds: string[]): Promise<SingleResponse<TodoAllowlistEntry[]>> {
  return apiPut('/tasks/allowlist', { listIds });
}

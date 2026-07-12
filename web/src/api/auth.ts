import { apiGet, apiPost, apiDelete } from './client';
import type { SingleResponse, ListResponse, AuthToken, Member, ApiKey, ApiKeyCreated } from '@/lib/types';

export function login(email: string, password: string): Promise<SingleResponse<AuthToken>> {
  return apiPost('/auth/token', { email, password });
}
export function whoami(): Promise<SingleResponse<Member>> {
  return apiGet('/auth/whoami');
}
export function listApiKeys(): Promise<ListResponse<ApiKey>> {
  return apiGet('/auth/keys');
}
export function createApiKey(name: string): Promise<SingleResponse<ApiKeyCreated>> {
  return apiPost('/auth/keys', { name });
}
export function revokeApiKey(id: string): Promise<SingleResponse<{ id: string }>> {
  return apiDelete(`/auth/keys/${id}`);
}

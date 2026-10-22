import { apiGet, apiPost, apiPatch, apiDelete } from './client';
import type { SingleResponse, ListResponse, Household, HouseholdApiKey, Member, Role, MemberRole, AvatarColor } from '@/lib/types';

export interface CreateMemberInput {
  email: string; password: string; displayName: string;
  avatarColor: AvatarColor; role?: MemberRole; handle?: string;
}
export interface UpdateMemberInput {
  displayName?: string; avatarColor?: AvatarColor; email?: string; password?: string;
}

/** The allowed timezone/locale/theme values, served by the API so the two never drift. */
export interface HouseholdOptions {
  timezones: string[];
  locales: { value: string; label: string }[];
  themes: { value: string; label: string }[];
}

export function getHousehold(): Promise<SingleResponse<Household>> {
  return apiGet('/household');
}
export function getHouseholdOptions(): Promise<SingleResponse<HouseholdOptions>> {
  return apiGet('/household/options');
}
export function updateHousehold(input: Partial<Pick<Household, 'name' | 'timezone' | 'locale' | 'theme'>>): Promise<SingleResponse<Household>> {
  return apiPatch('/household', input);
}
export function listMembers(): Promise<ListResponse<Member>> {
  return apiGet('/members');
}
export function createMember(input: CreateMemberInput): Promise<SingleResponse<Member>> {
  return apiPost('/members', input);
}
export function updateMember(id: string, input: UpdateMemberInput): Promise<SingleResponse<Member>> {
  return apiPatch(`/members/${id}`, input);
}
export function setMemberRole(id: string, role: Role): Promise<SingleResponse<Member>> {
  return apiPatch(`/members/${id}/role`, { role });
}
export function deleteMember(id: string): Promise<SingleResponse<{ id: string }>> {
  return apiDelete(`/members/${id}`);
}
/** Admin only: every member's API keys, without the secrets. */
export function listHouseholdKeys(): Promise<ListResponse<HouseholdApiKey>> {
  return apiGet('/household/keys');
}
/** Admin only: revoke any member's API key. */
export function revokeHouseholdKey(id: string): Promise<SingleResponse<{ id: string }>> {
  return apiDelete(`/household/keys/${id}`);
}

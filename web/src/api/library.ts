import { apiGet, apiPost, apiDelete, qs } from './client';
import type { SingleResponse, ListResponse, LibraryConnection, LibraryItem } from '@/lib/types';

export interface ListItemsParams {
  mediaType?: string; memberId?: string; provider?: string; status?: string; list?: string; tag?: string;
  limit?: number; offset?: number;
}
export interface TraktDevice { device_code: string; user_code: string; verification_url: string; interval: number; expires_in: number; }

export function listConnections(): Promise<ListResponse<LibraryConnection>> {
  return apiGet('/library/connections');
}
export function createLibraryThingConnection(userid: string, key: string): Promise<SingleResponse<LibraryConnection>> {
  return apiPost('/library/connections/librarything', { userid, key });
}
export function startTraktDevice(): Promise<SingleResponse<TraktDevice>> {
  return apiPost('/library/connections/trakt/device', {});
}
export function pollTraktDevice(device_code: string): Promise<SingleResponse<LibraryConnection> | SingleResponse<{ status: 'pending' }>> {
  return apiPost('/library/connections/trakt/device/poll', { device_code });
}
export function importLibraryThingFile(id: string, json: unknown): Promise<SingleResponse<{ imported: number }>> {
  return apiPost(`/library/connections/${id}/import`, json);
}
export function syncConnection(id: string): Promise<SingleResponse<LibraryConnection>> {
  return apiPost(`/library/connections/${id}/sync`, {});
}
export function deleteConnection(id: string): Promise<SingleResponse<{ id: string }>> {
  return apiDelete(`/library/connections/${id}`);
}
export function listItems(params: ListItemsParams = {}): Promise<ListResponse<LibraryItem>> {
  return apiGet(`/library/items${qs(params as Record<string, unknown>)}`);
}
export function searchItems(q: string): Promise<ListResponse<LibraryItem>> {
  return apiGet(`/library/items/search${qs({ q })}`);
}
export function getItem(id: string): Promise<SingleResponse<LibraryItem>> {
  return apiGet(`/library/items/${id}`);
}

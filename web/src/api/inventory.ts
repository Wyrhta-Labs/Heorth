import { apiGet, apiPost, apiPatch, apiDelete, qs } from './client';
import type { ListResponse, SingleResponse, InventoryItem, DecommissionReason } from '@/lib/types';

export interface ItemInput {
  name: string;
  category?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  location?: string | null;
  notes?: string | null;
  warrantyUntil?: string | null;
  purchasePrice?: number | null;
  purchaseDate?: string | null;
}

export interface DecommissionInput {
  date: string;
  reason: DecommissionReason;
  proceeds?: number;
}

export function listItems(
  params: { status?: 'active' | 'decommissioned'; category?: string; q?: string; limit?: number; offset?: number } = {},
): Promise<ListResponse<InventoryItem>> {
  return apiGet(`/inventory/items${qs(params)}`);
}
export function createItem(input: ItemInput): Promise<SingleResponse<InventoryItem>> { return apiPost('/inventory/items', input); }
export function getItem(id: string): Promise<SingleResponse<InventoryItem>> { return apiGet(`/inventory/items/${id}`); }
export function updateItem(id: string, input: Partial<ItemInput>): Promise<SingleResponse<InventoryItem>> { return apiPatch(`/inventory/items/${id}`, input); }
export function decommissionItem(id: string, input: DecommissionInput): Promise<SingleResponse<InventoryItem>> { return apiPost(`/inventory/items/${id}/decommission`, input); }
export function deleteItem(id: string): Promise<SingleResponse<{ id: string }>> { return apiDelete(`/inventory/items/${id}`); }

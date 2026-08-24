import { apiGet, apiPost, apiPatch, apiDelete, qs } from './client';
import type { ListResponse, SingleResponse, EthelAsset, DecommissionReason } from '@/lib/types';

export interface AssetInput {
  name: string;
  category?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  locationNote?: string | null;
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

export function listAssets(
  params: { status?: 'active' | 'decommissioned'; category?: string; q?: string; limit?: number; offset?: number } = {},
): Promise<ListResponse<EthelAsset>> {
  return apiGet(`/ethel/assets${qs(params)}`);
}
export function createAsset(input: AssetInput): Promise<SingleResponse<EthelAsset>> { return apiPost('/ethel/assets', input); }
export function getAsset(id: string): Promise<SingleResponse<EthelAsset>> { return apiGet(`/ethel/assets/${id}`); }
export function updateAsset(id: string, input: Partial<AssetInput>): Promise<SingleResponse<EthelAsset>> { return apiPatch(`/ethel/assets/${id}`, input); }
export function decommissionAsset(id: string, input: DecommissionInput): Promise<SingleResponse<EthelAsset>> { return apiPost(`/ethel/assets/${id}/decommission`, input); }
export function deleteAsset(id: string): Promise<SingleResponse<{ id: string }>> { return apiDelete(`/ethel/assets/${id}`); }

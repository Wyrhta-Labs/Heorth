import { apiGet, apiPost, apiPatch, apiDelete, qs } from './client';
import type { ListResponse, SingleResponse, EthelAsset, EthelPlace, PlaceKind, DecommissionReason } from '@/lib/types';

export interface AssetInput {
  name: string;
  category?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  placeId?: string | null;
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

/** `includeDescendants` is the STRING 'true'/'false', matching the server's
 *  `z.enum(['true','false'])` - a boolean would serialise the same way but
 *  invites a `z.coerce.boolean()` on the other side, where Boolean('false')
 *  is true. It is only accepted WITH `placeId`; without one the server answers
 *  400 VALIDATION_ERROR, so callers must not offer the combination. */
export function listAssets(
  params: {
    status?: 'active' | 'decommissioned';
    category?: string;
    q?: string;
    placeId?: string;
    includeDescendants?: 'true' | 'false';
    limit?: number;
    offset?: number;
  } = {},
): Promise<ListResponse<EthelAsset>> {
  return apiGet(`/ethel/assets${qs(params)}`);
}
export function createAsset(input: AssetInput): Promise<SingleResponse<EthelAsset>> { return apiPost('/ethel/assets', input); }
export function getAsset(id: string): Promise<SingleResponse<EthelAsset>> { return apiGet(`/ethel/assets/${id}`); }
export function updateAsset(id: string, input: Partial<AssetInput>): Promise<SingleResponse<EthelAsset>> { return apiPatch(`/ethel/assets/${id}`, input); }
export function decommissionAsset(id: string, input: DecommissionInput): Promise<SingleResponse<EthelAsset>> { return apiPost(`/ethel/assets/${id}/decommission`, input); }
export function deleteAsset(id: string): Promise<SingleResponse<{ id: string }>> { return apiDelete(`/ethel/assets/${id}`); }

export interface PlaceInput {
  name: string;
  kind: PlaceKind;
  parentId?: string | null;
  notes?: string | null;
}

// NOT ListResponse<EthelPlace>: that type requires `meta` (types.ts,
// `ListResponse<T> { data: T[]; meta: ListMeta }`), and GET /places answers
// with a bare `ok(c, rows)` and no meta because it is deliberately
// unpaginated. Typing it as ListResponse compiles - apiGet's return type is
// unchecked at runtime - and then any reader of `.meta.total` crashes on
// undefined.
export function listPlaces(): Promise<{ data: EthelPlace[] }> { return apiGet('/ethel/places'); }
export function createPlace(input: PlaceInput): Promise<SingleResponse<EthelPlace>> { return apiPost('/ethel/places', input); }
export function updatePlace(id: string, input: Partial<PlaceInput>): Promise<SingleResponse<EthelPlace>> { return apiPatch(`/ethel/places/${id}`, input); }
export function deletePlace(id: string): Promise<SingleResponse<{ id: string }>> { return apiDelete(`/ethel/places/${id}`); }

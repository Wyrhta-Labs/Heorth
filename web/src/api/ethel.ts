import { apiGet, apiPost, apiPatch, apiPut, apiDelete, qs } from './client';
import type { ListResponse, SingleResponse, EthelAsset, EthelAssetDetail, EthelVehicle, EthelFacility, EthelPlace, PlaceKind, FacilityKind, DecommissionReason } from '@/lib/types';

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
    // Same string-enum reasoning as includeDescendants. Unlike it, this one
    // stands alone - it needs no placeId.
    hasFacility?: 'true';
    servesPlaceId?: string;
    limit?: number;
    offset?: number;
  } = {},
): Promise<ListResponse<EthelAsset>> {
  return apiGet(`/ethel/assets${qs(params)}`);
}
export function createAsset(input: AssetInput): Promise<SingleResponse<EthelAsset>> { return apiPost('/ethel/assets', input); }
/** The single-asset read inlines `vehicle` and `facility`; the LIST does not. */
export function getAsset(id: string): Promise<SingleResponse<EthelAssetDetail>> { return apiGet(`/ethel/assets/${id}`); }
export function updateAsset(id: string, input: Partial<AssetInput>): Promise<SingleResponse<EthelAsset>> { return apiPatch(`/ethel/assets/${id}`, input); }
export function decommissionAsset(id: string, input: DecommissionInput): Promise<SingleResponse<EthelAsset>> { return apiPost(`/ethel/assets/${id}/decommission`, input); }
export function deleteAsset(id: string): Promise<SingleResponse<{ id: string }>> { return apiDelete(`/ethel/assets/${id}`); }

export interface VehicleInput {
  registration?: string | null;
  vin?: string | null;
  firstRegisteredOn?: string | null;
  // The server has a CHECK, mirrored in its validator, that these two are set
  // together: a mileage with no reading date is not a fact. The form enables
  // them together so this pair can never be half-filled on the wire.
  odometer?: number | null;
  odometerReadAt?: string | null;
  serviceIntervalMonths?: number | null;
}

export interface FacilityInput {
  kind: FacilityKind;
  commissionedOn?: string | null;
  serviceIntervalMonths?: number | null;
  /** Sent in FULL every time: the server replaces the served set wholesale
   *  rather than merging, so an omitted id is a removal. Duplicates are
   *  harmless - the server's validator dedupes them. */
  servesPlaceIds?: string[];
}

/** PUT, not POST: one detail row per asset, so the write is idempotent. The
 *  server answers 201 on create and 200 on update, and 409
 *  ASSET_DETAIL_CONFLICT when the asset already has the OTHER kind of
 *  detail - which the UI avoids by hiding the other action. */
export function upsertVehicle(id: string, input: VehicleInput): Promise<SingleResponse<EthelVehicle>> { return apiPut(`/ethel/assets/${id}/vehicle`, input); }
export function deleteVehicle(id: string): Promise<SingleResponse<{ assetId: string }>> { return apiDelete(`/ethel/assets/${id}/vehicle`); }
export function upsertFacility(id: string, input: FacilityInput): Promise<SingleResponse<EthelFacility>> { return apiPut(`/ethel/assets/${id}/facility`, input); }
export function deleteFacility(id: string): Promise<SingleResponse<{ assetId: string }>> { return apiDelete(`/ethel/assets/${id}/facility`); }

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

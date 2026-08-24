import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { QUERY_KEYS } from '@/lib/constants';
import * as api from '@/api/ethel';

export function useEthelAssets(params: Parameters<typeof api.listAssets>[0] = {}) {
  return useQuery({ queryKey: [...QUERY_KEYS.ethel, params], queryFn: () => api.listAssets(params) });
}

export function useCreateAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: api.AssetInput) => api.createAsset(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.ethel }),
  });
}

export function useUpdateAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<api.AssetInput> }) => api.updateAsset(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.ethel }),
  });
}

export function useDecommissionAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: api.DecommissionInput }) => api.decommissionAsset(id, input),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: QUERY_KEYS.ethel });
      // Server-side TCO totals (proceeds/total) read `asset.disposalProceeds`,
      // which decommission just set — invalidate itemCosts too so an open
      // detail panel's numbers aren't stale when no transaction was linked
      // (the linked-transaction path also invalidates this key, but that
      // only happens when a transaction was actually picked).
      qc.invalidateQueries({ queryKey: QUERY_KEYS.itemCosts(vars.id) });
    },
  });
}

export function useDeleteAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteAsset(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.ethel }),
  });
}

/** The single-asset read, which inlines the vehicle/facility details the LIST
 *  omits. Skipped for an empty id so the closed detail panel makes no request. */
export function useAsset(id: string) {
  return useQuery({
    queryKey: [...QUERY_KEYS.ethel, 'asset', id],
    queryFn: () => api.getAsset(id),
    enabled: !!id,
  });
}

/** Every detail mutation invalidates the whole `ethel` key, not just this
 *  asset: the list's `hasFacility` / `servesPlaceId` filters change the moment
 *  a detail row appears or goes, so a loaded page is stale either way. The
 *  asset key is a child of `ethel`, so the prefix invalidation covers it -
 *  it is named explicitly all the same, because that is the key the open
 *  panel actually reads. */
function invalidateDetail(qc: ReturnType<typeof useQueryClient>, id: string): void {
  qc.invalidateQueries({ queryKey: [...QUERY_KEYS.ethel, 'asset', id] });
  qc.invalidateQueries({ queryKey: QUERY_KEYS.ethel });
}

export function useUpsertVehicle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: api.VehicleInput }) => api.upsertVehicle(id, input),
    onSuccess: (_, vars) => invalidateDetail(qc, vars.id),
  });
}

export function useDeleteVehicle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteVehicle(id),
    onSuccess: (_, id) => invalidateDetail(qc, id),
  });
}

export function useUpsertFacility() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: api.FacilityInput }) => api.upsertFacility(id, input),
    onSuccess: (_, vars) => invalidateDetail(qc, vars.id),
  });
}

export function useDeleteFacility() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteFacility(id),
    onSuccess: (_, id) => invalidateDetail(qc, id),
  });
}

export function usePlaces() {
  return useQuery({ queryKey: QUERY_KEYS.ethelPlaces, queryFn: () => api.listPlaces() });
}

/** Every place mutation invalidates the ASSET list too: deleting a place
 *  unassigns the assets in it (ON DELETE SET NULL), and a rename changes the
 *  path the asset card renders, so the loaded asset pages are stale either
 *  way. */
function invalidatePlaces(qc: ReturnType<typeof useQueryClient>): void {
  qc.invalidateQueries({ queryKey: QUERY_KEYS.ethelPlaces });
  qc.invalidateQueries({ queryKey: QUERY_KEYS.ethel });
}

export function useCreatePlace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: api.PlaceInput) => api.createPlace(input),
    onSuccess: () => invalidatePlaces(qc),
  });
}

export function useUpdatePlace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<api.PlaceInput> }) => api.updatePlace(id, input),
    onSuccess: () => invalidatePlaces(qc),
  });
}

export function useDeletePlace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deletePlace(id),
    onSuccess: () => invalidatePlaces(qc),
  });
}

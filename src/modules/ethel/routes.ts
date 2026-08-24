import { Hono } from 'hono';
import type { Context } from 'hono';
import { ok, err } from '@wyrhta/core/http';
import { requireAuth, requireRole } from '../../wiring.js';
import * as service from './service.js';
import * as places from './places.js';
import * as details from './details.js';
import { createAssetSchema, updateAssetSchema, decommissionSchema, listAssetsQuerySchema, createPlaceSchema, updatePlaceSchema, vehicleSchema, facilitySchema } from './validators.js';

export const ethelRouter = new Hono();
ethelRouter.use('*', requireAuth);
const canWrite = requireRole('admin', 'adult');

ethelRouter.get('/assets', async (c) => {
  const q = listAssetsQuerySchema.safeParse(c.req.query());
  if (!q.success) return err(c, 'VALIDATION_ERROR', 'Invalid query parameters', 400);
  if (q.data.includeDescendants === 'true' && !q.data.placeId) {
    return err(c, 'VALIDATION_ERROR', 'includeDescendants requires placeId', 400);
  }
  const { rows, total, limit, offset } = await service.listAssets({
    ...q.data,
    // Translated at the boundary: the wire form is the string 'true'/'false'.
    includeDescendants: q.data.includeDescendants === 'true',
    hasFacility: q.data.hasFacility === 'true',
    servesPlaceId: q.data.servesPlaceId,
  });
  return ok(c, rows, { total, limit, offset });
});

ethelRouter.post('/assets', canWrite, async (c) => {
  const body = createAssetSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  try {
    return ok(c, await service.createAsset(body.data), undefined, 201);
  } catch (e: unknown) {
    if (e instanceof Error && e.message === 'PLACE_NOT_FOUND') {
      return err(c, 'PLACE_NOT_FOUND', 'That place does not exist', 400);
    }
    throw e;
  }
});

ethelRouter.get('/assets/:id', async (c) => {
  const row = await service.getAsset(c.req.param('id'));
  if (!row) return err(c, 'NOT_FOUND', 'Asset not found', 404);
  return ok(c, row);
});

ethelRouter.patch('/assets/:id', canWrite, async (c) => {
  const body = updateAssetSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  try {
    const row = await service.updateAsset(c.req.param('id'), body.data);
    if (!row) return err(c, 'NOT_FOUND', 'Asset not found', 404);
    return ok(c, row);
  } catch (e: unknown) {
    if (e instanceof Error && e.message === 'DISPOSAL_LINK_EXISTS') {
      return err(c, 'DISPOSAL_LINK_EXISTS', 'Unlink the disposal transaction before reactivating', 409);
    }
    if (e instanceof Error && e.message === 'PLACE_NOT_FOUND') {
      return err(c, 'PLACE_NOT_FOUND', 'That place does not exist', 400);
    }
    throw e;
  }
});

ethelRouter.post('/assets/:id/decommission', canWrite, async (c) => {
  const body = decommissionSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  try {
    const row = await service.decommissionAsset(c.req.param('id'), body.data);
    if (!row) return err(c, 'NOT_FOUND', 'Asset not found', 404);
    return ok(c, row);
  } catch (e: unknown) {
    if (e instanceof Error && e.message === 'ALREADY_DECOMMISSIONED') {
      return err(c, 'ALREADY_DECOMMISSIONED', 'Asset is already decommissioned', 409);
    }
    throw e;
  }
});

ethelRouter.delete('/assets/:id', canWrite, async (c) => {
  try {
    const row = await service.deleteAsset(c.req.param('id'));
    if (!row) return err(c, 'NOT_FOUND', 'Asset not found', 404);
    return ok(c, { id: row.id });
  } catch (e: unknown) {
    if (e instanceof Error && e.message === 'HAS_FINANCE_LINKS') {
      return err(c, 'HAS_FINANCE_LINKS', 'Asset has finance links - decommission instead of deleting', 409);
    }
    throw e;
  }
});

ethelRouter.put('/assets/:id/vehicle', canWrite, async (c) => {
  const body = vehicleSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  try {
    const res = await details.upsertVehicle(c.req.param('id'), body.data);
    if (!res) return err(c, 'NOT_FOUND', 'Asset not found', 404);
    return ok(c, res.row, undefined, res.created ? 201 : 200);
  } catch (e: unknown) {
    if (e instanceof Error && e.message === 'VEHICLE_REGISTRATION_TAKEN') return err(c, 'VEHICLE_REGISTRATION_TAKEN', 'That registration is already recorded', 409);
    if (e instanceof Error && e.message === 'VEHICLE_VIN_TAKEN') return err(c, 'VEHICLE_VIN_TAKEN', 'That VIN is already recorded', 409);
    if (e instanceof Error && e.message === 'ASSET_DETAIL_CONFLICT') return err(c, 'ASSET_DETAIL_CONFLICT', 'This asset already has facility details', 409);
    throw e;
  }
});

ethelRouter.delete('/assets/:id/vehicle', canWrite, async (c) => {
  const gone = await details.deleteVehicle(c.req.param('id'));
  if (!gone) return err(c, 'NOT_FOUND', 'Vehicle detail not found', 404);
  return ok(c, { assetId: c.req.param('id') });
});

ethelRouter.put('/assets/:id/facility', canWrite, async (c) => {
  const body = facilitySchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  try {
    const res = await details.upsertFacility(c.req.param('id'), body.data);
    if (!res) return err(c, 'NOT_FOUND', 'Asset not found', 404);
    return ok(c, res.row, undefined, res.created ? 201 : 200);
  } catch (e: unknown) {
    if (e instanceof Error && e.message === 'PLACE_NOT_FOUND') return err(c, 'PLACE_NOT_FOUND', 'One of the served places does not exist', 400);
    if (e instanceof Error && e.message === 'ASSET_DETAIL_CONFLICT') return err(c, 'ASSET_DETAIL_CONFLICT', 'This asset already has vehicle details', 409);
    throw e;
  }
});

ethelRouter.delete('/assets/:id/facility', canWrite, async (c) => {
  const gone = await details.deleteFacility(c.req.param('id'));
  if (!gone) return err(c, 'NOT_FOUND', 'Facility detail not found', 404);
  return ok(c, { assetId: c.req.param('id') });
});

/** Maps a places-service domain error to its HTTP shape. Returns null when the
 *  error is not one of ours, so the caller rethrows and the 500 stays a 500. */
function placeError(c: Context, e: unknown): Response | null {
  if (!(e instanceof Error)) return null;
  switch (e.message) {
    case 'PLACE_CYCLE': return err(c, 'PLACE_CYCLE', 'A place cannot be inside itself', 400);
    case 'PLACE_TOO_DEEP': return err(c, 'PLACE_TOO_DEEP', 'Places may not nest more than 6 deep', 400);
    case 'PLACE_NAME_TAKEN': return err(c, 'PLACE_NAME_TAKEN', 'A place with that name already exists here', 409);
    case 'PLACE_HAS_CHILDREN': return err(c, 'PLACE_HAS_CHILDREN', 'Move or delete the places inside it first', 409);
    case 'PLACE_NOT_FOUND': return err(c, 'PLACE_NOT_FOUND', 'The parent place does not exist', 400);
    default: return null;
  }
}

ethelRouter.get('/places', async (c) => ok(c, await places.listPlaces()));

ethelRouter.post('/places', canWrite, async (c) => {
  const body = createPlaceSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  try {
    return ok(c, await places.createPlace(body.data), undefined, 201);
  } catch (e: unknown) {
    const mapped = placeError(c, e);
    if (mapped) return mapped;
    throw e;
  }
});

ethelRouter.patch('/places/:id', canWrite, async (c) => {
  const body = updatePlaceSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  try {
    const row = await places.updatePlace(c.req.param('id'), body.data);
    if (!row) return err(c, 'NOT_FOUND', 'Place not found', 404);
    return ok(c, row);
  } catch (e: unknown) {
    const mapped = placeError(c, e);
    if (mapped) return mapped;
    throw e;
  }
});

ethelRouter.delete('/places/:id', canWrite, async (c) => {
  try {
    const row = await places.deletePlace(c.req.param('id'));
    if (!row) return err(c, 'NOT_FOUND', 'Place not found', 404);
    return ok(c, { id: row.id });
  } catch (e: unknown) {
    const mapped = placeError(c, e);
    if (mapped) return mapped;
    throw e;
  }
});

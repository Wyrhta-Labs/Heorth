import { Hono } from 'hono';
import { ok, err } from '@wyrhta/core/http';
import { requireAuth, requireRole } from '../../wiring.js';
import * as service from './service.js';
import { createAssetSchema, updateAssetSchema, decommissionSchema, listAssetsQuerySchema } from './validators.js';

export const ethelRouter = new Hono();
ethelRouter.use('*', requireAuth);
const canWrite = requireRole('admin', 'adult');

ethelRouter.get('/assets', async (c) => {
  const q = listAssetsQuerySchema.safeParse(c.req.query());
  if (!q.success) return err(c, 'VALIDATION_ERROR', 'Invalid query parameters', 400);
  const { rows, total, limit, offset } = await service.listAssets(q.data);
  return ok(c, rows, { total, limit, offset });
});

ethelRouter.post('/assets', canWrite, async (c) => {
  const body = createAssetSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  return ok(c, await service.createAsset(body.data), undefined, 201);
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

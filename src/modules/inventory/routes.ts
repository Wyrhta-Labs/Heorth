import { Hono } from 'hono';
import { ok, err } from '@wyrhta/core/http';
import { requireAuth, requireRole } from '../../wiring.js';
import * as service from './service.js';
import { createItemSchema, updateItemSchema, decommissionSchema, listItemsQuerySchema } from './validators.js';

export const inventoryRouter = new Hono();
inventoryRouter.use('*', requireAuth);
const canWrite = requireRole('admin', 'adult');

inventoryRouter.get('/items', async (c) => {
  const q = listItemsQuerySchema.safeParse(c.req.query());
  if (!q.success) return err(c, 'VALIDATION_ERROR', 'Invalid query parameters', 400);
  const { rows, total, limit, offset } = await service.listItems(q.data);
  return ok(c, rows, { total, limit, offset });
});

inventoryRouter.post('/items', canWrite, async (c) => {
  const body = createItemSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  return ok(c, await service.createItem(body.data), undefined, 201);
});

inventoryRouter.get('/items/:id', async (c) => {
  const row = await service.getItem(c.req.param('id'));
  if (!row) return err(c, 'NOT_FOUND', 'Item not found', 404);
  return ok(c, row);
});

inventoryRouter.patch('/items/:id', canWrite, async (c) => {
  const body = updateItemSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  try {
    const row = await service.updateItem(c.req.param('id'), body.data);
    if (!row) return err(c, 'NOT_FOUND', 'Item not found', 404);
    return ok(c, row);
  } catch (e: unknown) {
    if (e instanceof Error && e.message === 'DISPOSAL_LINK_EXISTS') {
      return err(c, 'DISPOSAL_LINK_EXISTS', 'Unlink the disposal transaction before reactivating', 409);
    }
    throw e;
  }
});

inventoryRouter.post('/items/:id/decommission', canWrite, async (c) => {
  const body = decommissionSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  try {
    const row = await service.decommissionItem(c.req.param('id'), body.data);
    if (!row) return err(c, 'NOT_FOUND', 'Item not found', 404);
    return ok(c, row);
  } catch (e: unknown) {
    if (e instanceof Error && e.message === 'ALREADY_DECOMMISSIONED') {
      return err(c, 'ALREADY_DECOMMISSIONED', 'Item is already decommissioned', 409);
    }
    throw e;
  }
});

inventoryRouter.delete('/items/:id', canWrite, async (c) => {
  try {
    const row = await service.deleteItem(c.req.param('id'));
    if (!row) return err(c, 'NOT_FOUND', 'Item not found', 404);
    return ok(c, { id: row.id });
  } catch (e: unknown) {
    if (e instanceof Error && e.message === 'HAS_FINANCE_LINKS') {
      return err(c, 'HAS_FINANCE_LINKS', 'Item has finance links - decommission instead of deleting', 409);
    }
    throw e;
  }
});

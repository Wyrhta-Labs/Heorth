import { Hono } from 'hono';
import { ok, err } from '@wyrhta/core/http';
import { requireAuth } from '../../wiring.js';
import * as service from './service.js';
import { createLibraryThingSchema, pollDeviceSchema, listItemsQuerySchema } from './validators.js';

export const libraryRouter = new Hono();
libraryRouter.use('*', requireAuth);

libraryRouter.get('/connections', async (c) => {
  return ok(c, await service.listConnections());
});

libraryRouter.post('/connections/librarything', async (c) => {
  const body = createLibraryThingSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'userid and key are required', 400);
  const conn = await service.createLibraryThingConnection(c.get('auth').userId, body.data);
  return ok(c, conn, undefined, 201);
});

libraryRouter.post('/connections/trakt/device', async (c) => {
  try {
    return ok(c, await service.startTraktDevice(), undefined, 201);
  } catch (e) {
    return err(c, 'TRAKT_UNCONFIGURED', (e as Error).message, 400);
  }
});

libraryRouter.post('/connections/trakt/device/poll', async (c) => {
  const body = pollDeviceSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'device_code required', 400);
  const result = await service.pollTraktDevice(c.get('auth').userId, body.data.device_code);
  if (result.status === 'pending') return c.json({ data: { status: 'pending' }, meta: {} }, 202);
  return ok(c, result.connection, undefined, 201);
});

libraryRouter.post('/connections/:id/import', async (c) => {
  try {
    const json = await c.req.json();
    const res = await service.importFile(c.get('auth').userId, c.req.param('id'), json);
    return ok(c, res);
  } catch (e) {
    if ((e as Error).message === 'NOT_FOUND') return err(c, 'NOT_FOUND', 'Connection not found', 404);
    return err(c, 'IMPORT_FAILED', (e as Error).message, 400);
  }
});

libraryRouter.post('/connections/:id/sync', async (c) => {
  try {
    return ok(c, await service.syncConnection(c.req.param('id')));
  } catch (e) {
    if ((e as Error).message === 'NOT_FOUND') return err(c, 'NOT_FOUND', 'Connection not found', 404);
    return c.json({ error: { code: 'SYNC_FAILED', message: (e as Error).message } }, 502);
  }
});

libraryRouter.delete('/connections/:id', async (c) => {
  try {
    const deleted = await service.deleteConnection(c.req.param('id'), c.get('auth'));
    if (!deleted) return err(c, 'NOT_FOUND', 'Connection not found', 404);
    return ok(c, deleted);
  } catch (e) {
    if ((e as Error).message === 'FORBIDDEN') return err(c, 'FORBIDDEN', 'Not allowed', 403);
    throw e;
  }
});

libraryRouter.get('/items/search', async (c) => {
  const q = c.req.query('q') ?? '';
  if (!q) return err(c, 'VALIDATION_ERROR', 'q is required', 400);
  return ok(c, await service.searchItems(q));
});

libraryRouter.get('/items/:id', async (c) => {
  const item = await service.getItem(c.req.param('id'));
  if (!item) return err(c, 'NOT_FOUND', 'Item not found', 404);
  return ok(c, item);
});

libraryRouter.get('/items', async (c) => {
  const parsed = listItemsQuerySchema.safeParse(c.req.query());
  if (!parsed.success) return err(c, 'VALIDATION_ERROR', 'Invalid query', 400);
  const { rows, total, limit, offset } = await service.listItems(parsed.data);
  return ok(c, rows, { total, limit, offset });
});

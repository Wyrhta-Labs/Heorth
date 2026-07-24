import { Hono } from 'hono';
import { ok, err } from '@wyrhta/core/http';
import { requireAuth } from '../../wiring.js';
import * as service from './service.js';
import { createEventSchema, updateEventSchema, moveEventSchema, listEventsQuerySchema } from './validators.js';

export const calendarRouter = new Hono();
calendarRouter.use('*', requireAuth);

/** Guard mutations: mirrored (external) events are read-only; children may only
 *  mutate events they created. */
async function assertCanMutate(c: Parameters<typeof requireAuth>[0], id: string): Promise<Response | null> {
  const source = await service.getEventSource(id);
  if (source === 'mirror') {
    return err(c, 'EVENT_READ_ONLY', 'Mirrored M365 events are read-only', 403);
  }
  const auth = c.get('auth');
  if (auth.role !== 'child') return null;
  const owner = await service.getEventOwner(id);
  if (owner === null) return err(c, 'NOT_FOUND', 'Event not found', 404);
  if (owner !== auth.userId) return err(c, 'FORBIDDEN', 'Children may only edit their own events', 403);
  return null;
}

calendarRouter.get('/', async (c) => {
  const q = listEventsQuerySchema.safeParse(c.req.query());
  if (!q.success) return err(c, 'VALIDATION_ERROR', 'Invalid query parameters', 400);
  const { rows, total, limit, offset } = await service.listEvents(q.data);
  return ok(c, rows, { total, limit, offset });
});

calendarRouter.post('/', async (c) => {
  const body = createEventSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  const event = await service.createEvent(body.data, c.get('auth').userId);
  return ok(c, event, undefined, 201);
});

calendarRouter.get('/:id', async (c) => {
  const event = await service.getEvent(c.req.param('id'));
  if (!event) return err(c, 'NOT_FOUND', 'Event not found', 404);
  return ok(c, event);
});

calendarRouter.patch('/:id', async (c) => {
  const blocked = await assertCanMutate(c, c.req.param('id'));
  if (blocked) return blocked;
  const body = updateEventSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  const event = await service.updateEvent(c.req.param('id'), body.data);
  if (!event) return err(c, 'NOT_FOUND', 'Event not found', 404);
  return ok(c, event);
});

calendarRouter.post('/:id/move', async (c) => {
  const blocked = await assertCanMutate(c, c.req.param('id'));
  if (blocked) return blocked;
  const body = moveEventSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  const event = await service.moveEvent(c.req.param('id'), body.data.startAt, body.data.endAt);
  if (!event) return err(c, 'NOT_FOUND', 'Event not found', 404);
  return ok(c, event);
});

calendarRouter.delete('/:id', async (c) => {
  const blocked = await assertCanMutate(c, c.req.param('id'));
  if (blocked) return blocked;
  const event = await service.deleteEvent(c.req.param('id'));
  if (!event) return err(c, 'NOT_FOUND', 'Event not found', 404);
  return ok(c, { id: event.id });
});

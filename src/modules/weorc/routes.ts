import { Hono } from 'hono';
import type { Context } from 'hono';
import { ok, err } from '@wyrhta/core/http';
import { requireAuth, requireRole } from '../../wiring.js';
import { runWeorcTick } from './engine.js';
import * as service from './service.js';
import * as store from './store.js';
import {
  completeSchema,
  createRoutineSchema,
  listOccurrencesQuerySchema,
  listRoutinesQuerySchema,
  skipSchema,
  updateRoutineSchema,
} from './validators.js';

export const weorcRouter = new Hono();
weorcRouter.use('*', requireAuth);
const canWrite = requireRole('admin', 'adult');

weorcRouter.get('/routines', async (c) => {
  const q = listRoutinesQuerySchema.safeParse(c.req.query());
  if (!q.success) return err(c, 'VALIDATION_ERROR', 'Invalid query parameters', 400);
  const { rows, total, limit, offset } = await service.listRoutines({
    active: q.data.active === undefined ? undefined : q.data.active === 'true',
    anchorAssetId: q.data.anchor_asset_id,
    anchorPlaceId: q.data.anchor_place_id,
    ownerMemberId: q.data.owner_member_id,
    limit: q.data.limit,
    offset: q.data.offset,
  });
  return ok(c, rows, { total, limit, offset });
});

weorcRouter.post('/routines', canWrite, async (c) => {
  const body = createRoutineSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  try {
    return ok(c, await service.createRoutine(body.data), undefined, 201);
  } catch (e: unknown) {
    return anchorError(c, e);
  }
});

weorcRouter.get('/routines/:id', async (c) => {
  const row = await service.getRoutineDetail(c.req.param('id'));
  if (!row) return err(c, 'NOT_FOUND', 'Routine not found', 404);
  return ok(c, row);
});

weorcRouter.patch('/routines/:id', canWrite, async (c) => {
  const body = updateRoutineSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  try {
    const row = await service.updateRoutine(c.req.param('id'), body.data);
    if (!row) return err(c, 'NOT_FOUND', 'Routine not found', 404);
    return ok(c, row);
  } catch (e: unknown) {
    return anchorError(c, e);
  }
});

weorcRouter.delete('/routines/:id', canWrite, async (c) => {
  try {
    const gone = await service.deleteRoutine(c.req.param('id'));
    if (!gone) return err(c, 'NOT_FOUND', 'Routine not found', 404);
    return ok(c, { deleted: true });
  } catch (e: unknown) {
    if (e instanceof service.RoutineHasHistoryError) {
      return err(c, 'ROUTINE_HAS_HISTORY', 'This routine has completion history - deactivate it instead', 409);
    }
    throw e;
  }
});

weorcRouter.get('/occurrences', async (c) => {
  const q = listOccurrencesQuerySchema.safeParse(c.req.query());
  if (!q.success) return err(c, 'VALIDATION_ERROR', 'Invalid query parameters', 400);
  const rows = await store.listOccurrences({
    status: q.data.status,
    routineId: q.data.routine_id,
    dueTo: q.data.due_to,
  });
  return ok(c, rows, { total: rows.length });
});

weorcRouter.post('/occurrences/:id/complete', canWrite, async (c) => {
  const body = completeSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  return terminate(c, () => service.completeOccurrence(c.req.param('id'), body.data, c.get('auth').userId));
});

weorcRouter.post('/occurrences/:id/skip', canWrite, async (c) => {
  const body = skipSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  return terminate(c, () => service.skipOccurrence(c.req.param('id'), body.data, c.get('auth').userId));
});

weorcRouter.post('/run', canWrite, async (c) => ok(c, await runWeorcTick()));

async function terminate(c: Context, run: () => Promise<service.TerminateResult | null>): Promise<Response> {
  try {
    const result = await run();
    if (!result) return err(c, 'NOT_FOUND', 'Occurrence not found', 404);
    return ok(c, result);
  } catch (e: unknown) {
    if (e instanceof service.AlreadyTerminalError) {
      return err(c, 'ALREADY_TERMINAL', 'That occurrence is already completed or skipped', 409);
    }
    throw e;
  }
}

function anchorError(c: Context, e: unknown): Response {
  if (e instanceof service.AnchorConflictError) {
    return err(c, 'ANCHOR_CONFLICT', 'A routine anchors to an asset or a place, not both', 400);
  }
  if (e instanceof service.AnchorNotFoundError) {
    return e.kind === 'asset'
      ? err(c, 'ASSET_NOT_FOUND', 'That asset does not exist', 400)
      : err(c, 'PLACE_NOT_FOUND', 'That place does not exist', 400);
  }
  throw e;
}

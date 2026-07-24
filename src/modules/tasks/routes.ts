import { Hono } from 'hono';
import type { Context } from 'hono';
import { ok, err } from '@wyrhta/core/http';
import { requireAuth } from '../../wiring.js';
import * as service from './service.js';
import { TaskProviderError } from './providers/types.js';
import {
  listTasksQuerySchema, completeTaskSchema, createTaskSchema, setAllowlistSchema,
} from './validators.js';

/**
 * Tasks REST surface, mounted at `/api/v1/tasks`. To Do is the system of record;
 * this surface reads the mirror and acts through the provider. All members may
 * read; any authenticated member (children included — it's a shared household
 * list) may complete/uncomplete and create. A write against a dead/absent member
 * connection returns a classified error, never a crash.
 */
export const tasksRouter = new Hono();
tasksRouter.use('*', requireAuth);

/**
 * Map a classified provider error to an HTTP status; rethrow anything else.
 *  - 409 CONFLICT: a member-actionable state — the relevant connection needs
 *    re-consent / is absent, or the shared/requested list is unavailable.
 *  - 500: the integration is off or an upstream Graph/network failure occurred.
 */
function writeError(c: Context, e: unknown): Response {
  if (e instanceof TaskProviderError) {
    const conflict =
      e.reason === 'needs_reauth' || e.reason === 'no_connection'
      || e.reason === 'shared_list_unavailable' || e.reason === 'unknown_list';
    return err(c, e.reason.toUpperCase(), e.message, conflict ? 409 : 500);
  }
  throw e;
}

// --- literal routes first (so they don't collide with /:id/…) --------------

/** Discover the acting member's To Do lists (each flagged allowlisted or not). */
tasksRouter.get('/lists', async (c) => {
  try {
    return ok(c, await service.listAvailableLists(c.get('auth').userId));
  } catch (e) {
    return writeError(c, e);
  }
});

/** The acting member's current allowlist. */
tasksRouter.get('/allowlist', async (c) => {
  return ok(c, await service.getAllowlist(c.get('auth').userId));
});

/** Replace the acting member's allowlist (which of their lists sync). */
tasksRouter.put('/allowlist', async (c) => {
  const body = setAllowlistSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  try {
    return ok(c, await service.setAllowlist(c.get('auth').userId, body.data.listIds));
  } catch (e) {
    return writeError(c, e);
  }
});

// --- task collection --------------------------------------------------------

/** List mirrored tasks (filters: status, member, list, due range). */
tasksRouter.get('/', async (c) => {
  const q = listTasksQuerySchema.safeParse(c.req.query());
  if (!q.success) return err(c, 'VALIDATION_ERROR', 'Invalid query parameters', 400);
  const rows = await service.listTasks({
    status: q.data.status,
    memberId: q.data.member_id,
    listId: q.data.list_id,
    dueFrom: q.data.due_from,
    dueTo: q.data.due_to,
  });
  return ok(c, rows, { total: rows.length });
});

/** Create a task into the shared household list. */
tasksRouter.post('/', async (c) => {
  const body = createTaskSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  try {
    const row = await service.createTask(
      { title: body.data.title, notes: body.data.notes ?? null, dueAt: body.data.dueAt ?? null },
      c.get('auth').userId,
    );
    return ok(c, row, undefined, 201);
  } catch (e) {
    return writeError(c, e);
  }
});

/** Complete / uncomplete a task (write-back + optimistic local update). */
tasksRouter.post('/:id/complete', async (c) => {
  const body = completeTaskSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  try {
    const row = await service.completeTask(c.req.param('id'), body.data.completed);
    if (!row) return err(c, 'NOT_FOUND', 'Task not found', 404);
    return ok(c, row);
  } catch (e) {
    return writeError(c, e);
  }
});

import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { ok, err } from '@wyrhta/core/http';
import { pgErrorCode } from '@wyrhta/core/db';
import * as service from './service.js';
import { runImportTick, getImportStatus } from './sync.js';
import {
  upsertAccountMappingSchema, createRuleSchema, updateRuleSchema,
  listInboxQuerySchema, confirmInboxSchema, manualLineSchema,
} from './validators.js';

/**
 * `/api/v1/feoh/ingestion/*` (ADR 0016). Mounted by the feoh router, which
 * already applies `requireAuth` to everything; the write gate is the feoh
 * router's own `canWrite` (role + maintenance-admin quarantine), passed in so
 * finance keeps ONE definition of "may write money".
 */
export function createIngestionRouter(canWrite: MiddlewareHandler): Hono {
  const r = new Hono();

  /** A FK failure on a body-supplied id (envelope, account) is the caller's mistake, not a 500. */
  const referenceError = (c: Context, e: unknown): Response | null =>
    pgErrorCode(e) === '23503' ? err(c, 'INVALID_REFERENCE', 'Referenced envelope or account does not exist', 400) : null;

  const inboxError = (c: Context, e: unknown): Response => {
    if (e instanceof Error) {
      if (e.message === 'NOT_FOUND') return err(c, 'NOT_FOUND', 'Inbox line not found', 404);
      if (e.message === 'NOT_PENDING') return err(c, 'NOT_PENDING', 'Only a pending line can be booked or dismissed', 409);
      if (e.message === 'CURRENCY_MISMATCH') return err(c, 'CURRENCY_MISMATCH', 'This line is not in the household currency and cannot be booked', 409);
      if (e.message === 'ACCOUNT_UNMAPPED') return err(c, 'ACCOUNT_UNMAPPED', 'The source account is not mapped — pass accountId or map it first', 409);
    }
    return referenceError(c, e) ?? (() => { throw e; })();
  };

  // ---- status + sync -------------------------------------------------------
  r.get('/status', async (c) => ok(c, await getImportStatus()));

  r.post('/sync', canWrite, async (c) => {
    const result = await runImportTick();
    if (result.ok) return ok(c, result);
    if (result.error === 'provider_unavailable') {
      return err(c, 'PROVIDER_UNAVAILABLE', 'Bank import is disabled (FEOH_IMPORT_ENABLED)', 409);
    }
    if (result.error === 'already_running') {
      return err(c, 'ALREADY_RUNNING', 'A bank import tick is already running', 409);
    }
    // Upstream failed; the tick already recorded it. 502 like the tasks routes do for provider 5xx.
    return c.json({ error: { code: (result.error ?? 'error').toUpperCase(), message: 'Bank import tick failed' } }, 502);
  });

  // ---- account mappings ----------------------------------------------------
  r.get('/accounts', async (c) => ok(c, await service.listAccountMappings()));
  r.put('/accounts', canWrite, async (c) => {
    const body = upsertAccountMappingSchema.safeParse(await c.req.json());
    if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
    try { return ok(c, await service.upsertAccountMapping(body.data)); }
    catch (e) { return referenceError(c, e) ?? (() => { throw e; })(); }
  });
  r.delete('/accounts/:id', canWrite, async (c) => {
    const row = await service.deleteAccountMapping(c.req.param('id'));
    if (!row) return err(c, 'NOT_FOUND', 'Mapping not found', 404);
    return ok(c, { id: row.id });
  });

  // ---- rules ---------------------------------------------------------------
  r.get('/rules', async (c) => ok(c, await service.listRules()));
  r.post('/rules', canWrite, async (c) => {
    const body = createRuleSchema.safeParse(await c.req.json());
    if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
    try { return ok(c, await service.createRule(body.data, c.get('auth').userId), undefined, 201); }
    catch (e) { return referenceError(c, e) ?? (() => { throw e; })(); }
  });
  r.patch('/rules/:id', canWrite, async (c) => {
    const body = updateRuleSchema.safeParse(await c.req.json());
    if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
    try {
      const row = await service.updateRule(c.req.param('id'), body.data);
      if (!row) return err(c, 'NOT_FOUND', 'Rule not found', 404);
      return ok(c, row);
    } catch (e) { return referenceError(c, e) ?? (() => { throw e; })(); }
  });
  r.delete('/rules/:id', canWrite, async (c) => {
    const row = await service.deleteRule(c.req.param('id'));
    if (!row) return err(c, 'NOT_FOUND', 'Rule not found', 404);
    return ok(c, { id: row.id });
  });

  // ---- inbox ---------------------------------------------------------------
  r.get('/inbox', async (c) => {
    const q = listInboxQuerySchema.safeParse(c.req.query());
    if (!q.success) return err(c, 'VALIDATION_ERROR', 'Invalid query parameters', 400);
    const { rows, total, limit, offset } = await service.listInbox(q.data);
    return ok(c, rows, { total, limit, offset });
  });
  r.post('/inbox', canWrite, async (c) => {
    const body = manualLineSchema.safeParse(await c.req.json());
    if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
    try {
      const { row, created } = await service.addManualLine(body.data);
      return ok(c, row, undefined, created ? 201 : 200);
    } catch (e) { return referenceError(c, e) ?? (() => { throw e; })(); }
  });
  r.post('/inbox/:id/confirm', canWrite, async (c) => {
    const body = confirmInboxSchema.safeParse(await c.req.json());
    if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
    try { return ok(c, await service.confirmInboxRow(c.req.param('id'), body.data, c.get('auth').userId)); }
    catch (e) { return inboxError(c, e); }
  });
  r.post('/inbox/:id/dismiss', canWrite, async (c) => {
    try { return ok(c, await service.dismissInboxRow(c.req.param('id'))); }
    catch (e) { return inboxError(c, e); }
  });

  return r;
}

import { Hono } from 'hono';
import { ok, err } from '@wyrhta/core/http';
import { requireAuth, requireRole } from '../../wiring.js';
import * as service from './service.js';
import { createAccountSchema, updateAccountSchema, createEnvelopeSchema, updateEnvelopeSchema } from './validators.js';

export const feohRouter = new Hono();
feohRouter.use('*', requireAuth);

// All write routes: admin + adult only (child may not edit finances).
const canWrite = requireRole('admin', 'adult');

feohRouter.get('/accounts', async (c) => ok(c, await service.listAccounts()));
feohRouter.post('/accounts', canWrite, async (c) => {
  const body = createAccountSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  return ok(c, await service.createAccount(body.data), undefined, 201);
});
feohRouter.patch('/accounts/:id', canWrite, async (c) => {
  const body = updateAccountSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  const row = await service.updateAccount(c.req.param('id'), body.data);
  if (!row) return err(c, 'NOT_FOUND', 'Account not found', 404);
  return ok(c, row);
});
feohRouter.delete('/accounts/:id', canWrite, async (c) => {
  const row = await service.deleteAccount(c.req.param('id'));
  if (!row) return err(c, 'NOT_FOUND', 'Account not found', 404);
  return ok(c, { id: row.id });
});

feohRouter.get('/envelopes', async (c) => ok(c, await service.listEnvelopes()));
feohRouter.post('/envelopes', canWrite, async (c) => {
  const body = createEnvelopeSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  return ok(c, await service.createEnvelope(body.data), undefined, 201);
});
feohRouter.patch('/envelopes/:id', canWrite, async (c) => {
  const body = updateEnvelopeSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  const row = await service.updateEnvelope(c.req.param('id'), body.data);
  if (!row) return err(c, 'NOT_FOUND', 'Envelope not found', 404);
  return ok(c, row);
});
feohRouter.delete('/envelopes/:id', canWrite, async (c) => {
  const row = await service.deleteEnvelope(c.req.param('id'));
  if (!row) return err(c, 'NOT_FOUND', 'Envelope not found', 404);
  return ok(c, { id: row.id });
});

export { canWrite };

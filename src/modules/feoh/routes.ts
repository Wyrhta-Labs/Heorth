import { Hono } from 'hono';
import { ok, err } from '@wyrhta/core/http';
import { requireAuth, requireRole } from '../../wiring.js';
import * as service from './service.js';
import { createAccountSchema, updateAccountSchema, createEnvelopeSchema, updateEnvelopeSchema, recordTransactionSchema, listTransactionsQuerySchema } from './validators.js';

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

feohRouter.get('/transactions', async (c) => {
  const q = listTransactionsQuerySchema.safeParse(c.req.query());
  if (!q.success) return err(c, 'VALIDATION_ERROR', 'Invalid query parameters', 400);
  const { rows, total, limit, offset } = await service.listTransactions(q.data);
  return ok(c, rows, { total, limit, offset });
});

feohRouter.post('/transactions', canWrite, async (c) => {
  const body = recordTransactionSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  try {
    const result = await service.recordTransaction(body.data, c.get('auth').userId);
    return ok(c, result, undefined, 201);
  } catch (e: unknown) {
    if (e instanceof Error && e.message === 'UNBALANCED') {
      return err(c, 'UNBALANCED', 'Postings do not balance (sum of debits must equal sum of credits)', 400);
    }
    throw e;
  }
});

feohRouter.get('/transactions/:id', async (c) => {
  const result = await service.getTransaction(c.req.param('id'));
  if (!result) return err(c, 'NOT_FOUND', 'Transaction not found', 404);
  return ok(c, result);
});

feohRouter.delete('/transactions/:id', canWrite, async (c) => {
  const row = await service.deleteTransaction(c.req.param('id'));
  if (!row) return err(c, 'NOT_FOUND', 'Transaction not found', 404);
  return ok(c, { id: row.id });
});

export { canWrite };

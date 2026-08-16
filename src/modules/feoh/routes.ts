import { Hono, type MiddlewareHandler } from 'hono';
import type { Context } from 'hono';
import { ok, err } from '@wyrhta/core/http';
import { requireAuth, requireRole } from '../../wiring.js';
import { assertNoneAreMaintenanceAdmin, assertNotMaintenanceAdmin } from '../../household/maintenance-admin.js';
import * as service from './service.js';
import * as occ from './occurrences.js';
import * as itemCosts from './item-costs.js';
import { getAccountLedger } from './ledger.js';
import { createAccountSchema, updateAccountSchema, createEnvelopeSchema, updateEnvelopeSchema, recordTransactionSchema, listTransactionsQuerySchema, monthQuerySchema, createBillSchema, updateBillSchema, occurrenceRefSchema, linkOccurrenceSchema, overrideOccurrenceSchema, listOccurrencesQuerySchema, createItemCostSchema } from './validators.js';

export const feohRouter = new Hono();
feohRouter.use('*', requireAuth);

const requireWriteRole = requireRole('admin', 'adult');
/** Write gate for every finance mutation route: role check + maintenance-admin
 *  quarantine on the acting principal (same composition the satellite proxy used). */
const canWrite: MiddlewareHandler = async (c, next) =>
  requireWriteRole(c, async () => {
    await assertNotMaintenanceAdmin(c.get('auth').userId);
    await next();
  });

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

feohRouter.get('/accounts/:id/ledger', async (c) => {
  const q = listTransactionsQuerySchema.safeParse(c.req.query());
  if (!q.success) return err(c, 'VALIDATION_ERROR', 'Invalid query parameters', 400);
  const ledger = await getAccountLedger(c.req.param('id'), q.data);
  if (!ledger) return err(c, 'NOT_FOUND', 'Account not found', 404);
  return ok(c, ledger.entries, ledger.meta);
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
  if (body.data.splits && body.data.splits.length > 0) {
    await assertNoneAreMaintenanceAdmin(body.data.splits.map((s) => s.memberId));
  }
  try {
    const result = await service.recordTransaction(body.data, c.get('auth').userId);
    return ok(c, result, undefined, 201);
  } catch (e: unknown) {
    if (e instanceof Error && e.message === 'UNBALANCED') {
      return err(c, 'UNBALANCED', 'Postings do not balance (sum of debits must equal sum of credits)', 400);
    }
    if (e instanceof Error && e.message === 'ORPHAN_POSTING') {
      return err(c, 'VALIDATION_ERROR', 'Each posting must reference an account or envelope', 400);
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

feohRouter.get('/summary', async (c) => {
  const q = monthQuerySchema.safeParse(c.req.query());
  if (!q.success) return err(c, 'VALIDATION_ERROR', 'month (YYYY-MM) is required', 400);
  return ok(c, await service.getMonthSummary(q.data.month));
});

feohRouter.get('/bills', async (c) => ok(c, await service.listBills()));
feohRouter.post('/bills', canWrite, async (c) => {
  const body = createBillSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  return ok(c, await service.createBill(body.data), undefined, 201);
});
feohRouter.patch('/bills/:id', canWrite, async (c) => {
  const body = updateBillSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  const row = await service.updateBill(c.req.param('id'), body.data);
  if (!row) return err(c, 'NOT_FOUND', 'Bill not found', 404);
  return ok(c, row);
});
feohRouter.delete('/bills/:id', canWrite, async (c) => {
  try {
    const row = await service.deleteBill(c.req.param('id'));
    if (!row) return err(c, 'NOT_FOUND', 'Bill not found', 404);
    return ok(c, { id: row.id });
  } catch (e: unknown) {
    if (e instanceof Error && e.message === 'BILL_HAS_HISTORY') {
      return err(c, 'BILL_HAS_HISTORY', 'Bill has recorded occurrence history and cannot be deleted', 409);
    }
    throw e;
  }
});

const OCC_ERRORS: Record<string, [string, string, number]> = {
  NOT_FOUND_BILL: ['NOT_FOUND', 'Bill not found', 404],
  NOT_FOUND_TRANSACTION: ['NOT_FOUND', 'Transaction not found', 404],
  NOT_AN_OCCURRENCE: ['NOT_AN_OCCURRENCE', 'dueDate is not an occurrence of this bill', 400],
  ALREADY_PAID: ['ALREADY_PAID', 'Occurrence is already linked to a transaction', 409],
  ALREADY_SKIPPED: ['ALREADY_SKIPPED', 'Occurrence is skipped', 409],
};
async function occCall(c: Context, fn: () => Promise<void>) {
  try { await fn(); return ok(c, { ok: true }); }
  catch (e: unknown) {
    const m = e instanceof Error ? OCC_ERRORS[e.message] : undefined;
    if (m) return err(c, m[0], m[1], m[2] as 400);
    throw e;
  }
}

feohRouter.get('/occurrences', async (c) => {
  const q = listOccurrencesQuerySchema.safeParse(c.req.query());
  if (!q.success) return err(c, 'VALIDATION_ERROR', 'Invalid query parameters', 400);
  return ok(c, await occ.listOccurrences(q.data));
});
feohRouter.post('/occurrences/link', canWrite, async (c) => {
  const body = linkOccurrenceSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  return occCall(c, () => occ.linkOccurrence(body.data));
});
feohRouter.post('/occurrences/skip', canWrite, async (c) => {
  const body = occurrenceRefSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  return occCall(c, () => occ.skipOccurrence(body.data));
});
feohRouter.post('/occurrences/unlink', canWrite, async (c) => {
  const body = occurrenceRefSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  return occCall(c, () => occ.unlinkOccurrence(body.data));
});
feohRouter.post('/occurrences/unskip', canWrite, async (c) => {
  const body = occurrenceRefSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  return occCall(c, () => occ.unskipOccurrence(body.data));
});
feohRouter.patch('/occurrences/override', canWrite, async (c) => {
  const body = overrideOccurrenceSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  return occCall(c, () => occ.overrideOccurrence(body.data));
});

const COST_ERRORS: Record<string, [string, string, number]> = {
  NOT_FOUND_TRANSACTION: ['NOT_FOUND', 'Transaction not found', 404],
  NOT_FOUND_ITEM: ['NOT_FOUND', 'Item not found', 404],
  ITEM_DECOMMISSIONED: ['ITEM_DECOMMISSIONED', 'Only disposal links are allowed on a decommissioned item', 409],
  NOT_A_COST: ['NOT_A_COST', 'Transaction has no envelope spending - transfers cannot be item costs', 400],
  DUPLICATE_LINK: ['DUPLICATE_LINK', 'This link already exists (or purchase/disposal already linked)', 409],
};

feohRouter.get('/item-costs/:itemId', async (c) => {
  const breakdown = await itemCosts.getItemCosts(c.req.param('itemId'));
  if (!breakdown) return err(c, 'NOT_FOUND', 'Item not found', 404);
  return ok(c, breakdown);
});
feohRouter.post('/item-costs', canWrite, async (c) => {
  const body = createItemCostSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  try { return ok(c, await itemCosts.createItemCost(body.data), undefined, 201); }
  catch (e: unknown) {
    const m = e instanceof Error ? COST_ERRORS[e.message] : undefined;
    if (m) return err(c, m[0], m[1], m[2] as 400);
    throw e;
  }
});
feohRouter.delete('/item-costs/:id', canWrite, async (c) => {
  const row = await itemCosts.deleteItemCost(c.req.param('id'));
  if (!row) return err(c, 'NOT_FOUND', 'Link not found', 404);
  return ok(c, { id: row.id });
});

feohRouter.get('/export', async (c) => {
  const format = c.req.query('format') ?? 'csv';
  if (format === 'ledger') {
    const ledger = await service.exportLedger();
    return c.text(ledger, 200, { 'Content-Type': 'text/plain; charset=utf-8' });
  }
  const csv = await service.exportTransactionsCsv();
  return c.text(csv, 200, { 'Content-Type': 'text/csv; charset=utf-8' });
});

feohRouter.post('/import', canWrite, async (c) => {
  const text = await c.req.text();
  if (!text.trim()) return err(c, 'VALIDATION_ERROR', 'CSV body is empty', 400);
  try {
    const result = await service.importTransactionsCsv(text, c.get('auth').userId);
    return ok(c, result, undefined, 201);
  } catch (e: unknown) {
    if (e instanceof Error && e.message === 'UNKNOWN_REFERENCE') {
      return err(c, 'UNKNOWN_REFERENCE', 'CSV references an unknown envelope or account name', 400);
    }
    if (e instanceof Error && e.message === 'CSV_INVALID_ROW') {
      return err(c, 'VALIDATION_ERROR', 'CSV contains an invalid row (bad date, non-numeric amount, or no envelope/account reference)', 400);
    }
    if (e instanceof Error && e.message === 'CSV_INVALID_HEADER') {
      return err(c, 'VALIDATION_ERROR', 'CSV header is missing required columns (date, payee, amount)', 400);
    }
    throw e;
  }
});

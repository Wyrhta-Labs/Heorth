import { Hono, type Context, type MiddlewareHandler } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { logError } from '@wyrhta/core/lib';
import { assertNoneAreMaintenanceAdmin, assertNotMaintenanceAdmin } from '../../household/maintenance-admin.js';
import { requireAuth, requireRole } from '../../wiring.js';
import { SatelliteUnreachableError, type SatelliteRequest } from '../satellite-client.js';
import { getFeohRuntime } from './runtime.js';
import { RosterMappingMissingError, type FeohRoster } from './roster.js';

/**
 * Finance proxy: replaces the old in-process `feoh` module's routes with
 * transparent pass-throughs to the Feoh satellite, mounted at the SAME paths
 * (`/api/v1/feoh/*`). Auth/role guards that the module applied stay on the
 * Heorth side; the only payloads touched are the member-boundary fields:
 *
 *  Inbound  (Heorth → Feoh):
 *   - transaction `createdBy` — injected from the acting principal (the module
 *     derived it from auth; Feoh requires it explicitly as a party id);
 *   - CSV import `createdBy` — same, injected as a `?createdBy=` query param;
 *   - expense-split `memberId` → `partyId`.
 *
 *  Outbound (Feoh → Heorth):
 *   - transaction `createdBy` (party id) → member id;
 *   - expense-split `partyId` → `memberId`.
 *   The web UI reads neither field today (verified against web/src + types.ts),
 *   so this translation is belt-and-braces faithfulness: responses stay
 *   byte-identical to the pre-extraction module, and it degrades gracefully
 *   (an unmapped id passes through unchanged rather than erroring).
 *
 * Error mapping: a Feoh 4xx/5xx passes straight through with its envelope and
 * status (Feoh reuses core's error codes, so VALIDATION_ERROR/UNBALANCED/
 * NOT_FOUND/etc. are preserved). A Feoh that is unreachable or times out
 * becomes a 503 in Heorth's error envelope. A `RosterMappingMissingError`
 * (the acting member is still unmapped after a *successful* re-sync — Feoh
 * was reachable, so this isn't a 503) becomes a 500 `ROSTER_MAPPING_MISSING`
 * with the member id logged for investigation: it signals an unexpected
 * invariant violation (a household member with no corresponding Feoh party),
 * not a transient/retryable condition a 503 would imply.
 */

type Json = Record<string, unknown>;

const requireWriteRole = requireRole('admin', 'adult');
/**
 * Write gate for every finance mutation route: the existing role check, plus
 * the maintenance-admin quarantine on the acting principal. Composed once here
 * rather than repeated per route (there are twelve) — `requireRole` returns a
 * plain Hono `MiddlewareHandler`, so wrapping it and calling `next` ourselves
 * after the extra check slots in exactly where the role check used to sit.
 */
const canWrite: MiddlewareHandler = async (c, next) =>
  requireWriteRole(c, async () => {
    await assertNotMaintenanceAdmin(c.get('auth').userId);
    await next();
  });

function serviceUnavailable(c: Context, e: unknown) {
  logError('feoh proxy: Feoh satellite unreachable', e);
  return c.json(
    { error: { code: 'SERVICE_UNAVAILABLE', message: 'The finance service is currently unavailable' } },
    503,
  );
}

function rosterMappingMissing(c: Context, e: RosterMappingMissingError) {
  logError(`feoh proxy: roster mapping missing after re-sync (memberId=${e.memberId})`, e);
  return c.json(
    { error: { code: 'ROSTER_MAPPING_MISSING', message: 'No Feoh party is mapped for the acting household member' } },
    500,
  );
}

interface ForwardOptions {
  transformRequest?: (body: Json, c: Context, roster: FeohRoster) => Promise<Json> | Json;
  transformQuery?: (
    query: Record<string, string>,
    c: Context,
    roster: FeohRoster,
  ) => Promise<Record<string, string>> | Record<string, string>;
  transformResponse?: (envelope: Json, roster: FeohRoster) => Json;
}

/** Forward a JSON request/response, applying any member-boundary translation. */
async function forwardJson(
  c: Context,
  method: string,
  feohSubPath: string,
  opts: ForwardOptions = {},
): Promise<Response> {
  const { client, roster } = getFeohRuntime();
  try {
    let body: string | undefined;
    let contentType: string | undefined;
    if (method === 'POST' || method === 'PATCH' || method === 'PUT') {
      let json = (await c.req.json()) as Json;
      if (opts.transformRequest) json = await opts.transformRequest(json, c, roster);
      body = JSON.stringify(json);
      contentType = 'application/json';
    }

    let query: Record<string, string> = c.req.query();
    if (opts.transformQuery) query = await opts.transformQuery(query, c, roster);

    const req: SatelliteRequest = { method, path: `/api/v1/feoh${feohSubPath}`, query, body, contentType };
    const res = await client.forward(req);

    const parsed = res.text ? (JSON.parse(res.text) as Json) : null;
    const out =
      res.status < 400 && parsed && opts.transformResponse ? opts.transformResponse(parsed, roster) : parsed;
    return c.json(out, res.status as ContentfulStatusCode);
  } catch (e) {
    if (e instanceof SatelliteUnreachableError) return serviceUnavailable(c, e);
    if (e instanceof RosterMappingMissingError) return rosterMappingMissing(c, e);
    throw e;
  }
}

// --- member-boundary translation helpers -------------------------------------

/** Inject `createdBy` (acting principal's party) and translate split member ids. */
async function transformRecordTransaction(body: Json, c: Context, roster: FeohRoster): Promise<Json> {
  const memberId = c.get('auth').userId;
  const createdBy = await roster.partyIdFor(memberId);
  const out: Json = { ...body, createdBy };
  if (Array.isArray(body['splits'])) {
    await assertNoneAreMaintenanceAdmin(
      (body['splits'] as Array<{ memberId: string }>).map((s) => s.memberId),
    );
    out['splits'] = await Promise.all(
      (body['splits'] as Array<{ memberId: string; share: number }>).map(async (s) => ({
        partyId: await roster.partyIdFor(s.memberId),
        share: s.share,
      })),
    );
  }
  return out;
}

/** Reverse split `partyId` → `memberId` and transaction `createdBy` in a detail. */
function reverseTransactionDetail(envelope: Json, roster: FeohRoster): Json {
  const data = envelope['data'] as Json | undefined;
  if (!data) return envelope;
  const txn = data['transaction'] as Json | undefined;
  if (txn && typeof txn['createdBy'] === 'string') {
    txn['createdBy'] = roster.memberIdFor(txn['createdBy']) ?? txn['createdBy'];
  }
  if (Array.isArray(data['splits'])) {
    data['splits'] = (data['splits'] as Array<Record<string, unknown>>).map((s) => ({
      id: s['id'],
      transactionId: s['transactionId'],
      memberId: roster.memberIdFor(s['partyId'] as string) ?? s['partyId'],
      share: s['share'],
    }));
  }
  return envelope;
}

/** Reverse `createdBy` on each transaction in a list response. */
function reverseTransactionList(envelope: Json, roster: FeohRoster): Json {
  if (Array.isArray(envelope['data'])) {
    envelope['data'] = (envelope['data'] as Array<Record<string, unknown>>).map((t) =>
      typeof t['createdBy'] === 'string'
        ? { ...t, createdBy: roster.memberIdFor(t['createdBy']) ?? t['createdBy'] }
        : t,
    );
  }
  return envelope;
}

// --- router ------------------------------------------------------------------

export function createFeohProxyRouter(): Hono {
  const router = new Hono();
  router.use('*', requireAuth);

  // Accounts
  router.get('/accounts', (c) => forwardJson(c, 'GET', '/accounts'));
  router.post('/accounts', canWrite, (c) => forwardJson(c, 'POST', '/accounts'));
  router.patch('/accounts/:id', canWrite, (c) => forwardJson(c, 'PATCH', `/accounts/${c.req.param('id')}`));
  router.delete('/accounts/:id', canWrite, (c) => forwardJson(c, 'DELETE', `/accounts/${c.req.param('id')}`));

  // Envelopes
  router.get('/envelopes', (c) => forwardJson(c, 'GET', '/envelopes'));
  router.post('/envelopes', canWrite, (c) => forwardJson(c, 'POST', '/envelopes'));
  router.patch('/envelopes/:id', canWrite, (c) => forwardJson(c, 'PATCH', `/envelopes/${c.req.param('id')}`));
  router.delete('/envelopes/:id', canWrite, (c) => forwardJson(c, 'DELETE', `/envelopes/${c.req.param('id')}`));

  // Transactions
  router.get('/transactions', (c) =>
    forwardJson(c, 'GET', '/transactions', { transformResponse: reverseTransactionList }),
  );
  router.post('/transactions', canWrite, (c) =>
    forwardJson(c, 'POST', '/transactions', {
      transformRequest: transformRecordTransaction,
      transformResponse: reverseTransactionDetail,
    }),
  );
  router.get('/transactions/:id', (c) =>
    forwardJson(c, 'GET', `/transactions/${c.req.param('id')}`, { transformResponse: reverseTransactionDetail }),
  );
  router.delete('/transactions/:id', canWrite, (c) =>
    forwardJson(c, 'DELETE', `/transactions/${c.req.param('id')}`),
  );

  // Summary
  router.get('/summary', (c) => forwardJson(c, 'GET', '/summary'));

  // Bills
  router.get('/bills', (c) => forwardJson(c, 'GET', '/bills'));
  router.post('/bills', canWrite, (c) => forwardJson(c, 'POST', '/bills'));
  router.patch('/bills/:id', canWrite, (c) => forwardJson(c, 'PATCH', `/bills/${c.req.param('id')}`));
  router.delete('/bills/:id', canWrite, (c) => forwardJson(c, 'DELETE', `/bills/${c.req.param('id')}`));

  // Export — text/csv or text/plain, passed through verbatim.
  router.get('/export', async (c) => {
    const { client } = getFeohRuntime();
    try {
      const res = await client.forward({
        method: 'GET',
        path: '/api/v1/feoh/export',
        query: c.req.query(),
        accept: 'text/plain',
      });
      return c.body(
        res.text,
        res.status as ContentfulStatusCode,
        res.contentType ? { 'Content-Type': res.contentType } : undefined,
      );
    } catch (e) {
      if (e instanceof SatelliteUnreachableError) return serviceUnavailable(c, e);
      throw e;
    }
  });

  // Import — raw CSV body; `createdBy` injected as a query param.
  router.post('/import', canWrite, async (c) => {
    const { client, roster } = getFeohRuntime();
    try {
      const createdBy = await roster.partyIdFor(c.get('auth').userId);
      const text = await c.req.text();
      const res = await client.forward({
        method: 'POST',
        path: '/api/v1/feoh/import',
        query: { createdBy },
        body: text,
        contentType: 'text/csv',
      });
      const parsed = res.text ? (JSON.parse(res.text) as Json) : null;
      return c.json(parsed, res.status as ContentfulStatusCode);
    } catch (e) {
      if (e instanceof SatelliteUnreachableError) return serviceUnavailable(c, e);
      if (e instanceof RosterMappingMissingError) return rosterMappingMissing(c, e);
      throw e;
    }
  });

  return router;
}

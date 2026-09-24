import { Hono, type Context } from 'hono';
import { ok, err } from '@wyrhta/core/http';
import { logEvent } from '@wyrhta/core/lib';
import { requireAuth, requireRole } from '../../wiring.js';
import { getGewritRuntime } from './runtime.js';
import { isDocumentProviderError, type DocumentProviderError } from './providers/types.js';
import { previewHeaders } from './preview.js';
import * as service from './service.js';
import { createLinkSchema, updateLinkSchema, searchQuerySchema, uuidSchema } from './validators.js';

/**
 * Gewrit REST surface, mounted at /api/v1/gewrit only when GEWRIT_PROVIDER is
 * set (index.ts). Search and every write are admin/adult: search reaches every
 * document shared with the `heorth` user, linked or not. Element lists and the
 * preview of LINKED documents are open to every member.
 */
export const gewritRouter = new Hono();
gewritRouter.use('*', requireAuth);
const canWrite = requireRole('admin', 'adult');

function providerFailure(c: Context, e: DocumentProviderError): Response {
  if (e.reason === 'auth') {
    // Its own code, so a wrong token is never mistaken for an outage. Logged
    // without the token or any upstream detail.
    logEvent({ event: 'gewrit.credential.rejected', success: false, request_id: c.get('requestId') });
    return c.json({ error: { code: 'PROVIDER_AUTH', message: "Paperless refused Heorth's credential" } }, 502);
  }
  // Every other reason is an outage, not a credential problem — logged too, so
  // it shows up in the same place as the auth event.
  logEvent({ event: 'gewrit.provider.unavailable', success: false, reason: e.reason, request_id: c.get('requestId') });
  // `err` caps at 500; an upstream failure is a 502 like the kith routes.
  return c.json({ error: { code: 'PROVIDER_UNAVAILABLE', message: 'Paperless is unavailable' } }, 502);
}

function fail(c: Context, e: unknown): Response {
  if (isDocumentProviderError(e)) return providerFailure(c, e);
  if (e instanceof service.GewritError) {
    if (e.code === 'ALREADY_LINKED') return err(c, e.code, e.message, 409);
    return c.json({ error: { code: e.code, message: e.message } }, 422);
  }
  throw e;
}

async function listFor(c: Context, el: service.ElementRef): Promise<Response> {
  const r = await service.listForElement(getGewritRuntime(), el);
  if (!r) return err(c, 'ELEMENT_NOT_FOUND', 'That asset or place does not exist', 404);
  return ok(c, r.links, { stale: r.stale, staleReason: r.staleReason });
}

gewritRouter.get('/documents/search', canWrite, async (c) => {
  const q = searchQuerySchema.safeParse({ q: c.req.query('q') });
  if (!q.success) return err(c, 'VALIDATION_ERROR', 'q must be 2 to 200 characters', 400);
  try {
    return ok(c, await getGewritRuntime().search(q.data.q, service.SEARCH_LIMIT));
  } catch (e) {
    return fail(c, e);
  }
});

gewritRouter.get('/assets/:id/documents', async (c) => {
  const id = uuidSchema.safeParse(c.req.param('id'));
  if (!id.success) return err(c, 'VALIDATION_ERROR', 'Invalid asset id', 400);
  return listFor(c, { assetId: id.data });
});

gewritRouter.get('/places/:id/documents', async (c) => {
  const id = uuidSchema.safeParse(c.req.param('id'));
  if (!id.success) return err(c, 'VALIDATION_ERROR', 'Invalid place id', 400);
  return listFor(c, { placeId: id.data });
});

gewritRouter.post('/links', canWrite, async (c) => {
  const body = createLinkSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  try {
    return ok(c, await service.createLink(getGewritRuntime(), body.data), undefined, 201);
  } catch (e) {
    return fail(c, e);
  }
});

gewritRouter.patch('/links/:id', canWrite, async (c) => {
  const id = uuidSchema.safeParse(c.req.param('id'));
  const body = updateLinkSchema.safeParse(await c.req.json().catch(() => null));
  if (!id.success || !body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request', 400);
  try {
    const view = await service.updateLink(getGewritRuntime(), id.data, body.data);
    return view ? ok(c, view) : err(c, 'LINK_NOT_FOUND', 'No such link', 404);
  } catch (e) {
    return fail(c, e);
  }
});

gewritRouter.delete('/links/:id', canWrite, async (c) => {
  const id = uuidSchema.safeParse(c.req.param('id'));
  if (!id.success) return err(c, 'VALIDATION_ERROR', 'Invalid link id', 400);
  return (await service.deleteLink(id.data)) ? ok(c, { id: id.data }) : err(c, 'LINK_NOT_FOUND', 'No such link', 404);
});

gewritRouter.get('/documents/:id/preview', async (c) => {
  const id = uuidSchema.safeParse(c.req.param('id'));
  if (!id.success) return err(c, 'VALIDATION_ERROR', 'Invalid document id', 400);
  const provider = getGewritRuntime();
  // The gate: only a document with at least one link, and only from the
  // provider that is live now. Heorth is not a proxy onto all of Paperless.
  const target = await service.previewTarget(id.data);
  if (!target || target.source !== provider.id) return err(c, 'DOCUMENT_NOT_FOUND', 'No linked document with that id', 404);
  try {
    // The request's signal aborts the upstream fetch when the member closes
    // the preview mid-download.
    const stream = await provider.openPreview(target.externalId, { signal: c.req.raw.signal });
    return new Response(stream.body, { status: 200, headers: previewHeaders(stream) });
  } catch (e) {
    if (isDocumentProviderError(e) && e.reason === 'not_found') {
      await service.markMissing(target.id);
      return err(c, 'DOCUMENT_NOT_FOUND', 'Paperless no longer has that document', 404);
    }
    return fail(c, e);
  }
});

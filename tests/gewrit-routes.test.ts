// Gating needs a fresh module graph per env state (see tests/kith-gating.test.ts).
// The fake is installed through the FRESH graph's setGewritRuntime; its errors
// are duck-typed, so they classify in any graph.
import { describe, it, expect, vi, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { gewritDocuments } from '../src/modules/gewrit/schema.js';
import { seedTestHousehold, authHeaders } from './helpers.js';
import { createFakeDocuments, doc, type FakeDocuments } from './fake-documents.js';

const KEYS = ['GEWRIT_PROVIDER', 'PAPERLESS_BASE_URL', 'PAPERLESS_TOKEN', 'PAPERLESS_PUBLIC_URL'];
afterAll(() => { for (const k of KEYS) delete process.env[k]; });

const UNKNOWN = '00000000-0000-4000-8000-000000000000';

async function freshApp(provider: string | null) {
  for (const k of KEYS) delete process.env[k];
  if (provider) process.env['GEWRIT_PROVIDER'] = provider;
  vi.resetModules();
  const { createApp } = await import('../src/app.js');
  const { ALL_MODULES } = await import('../src/modules/index.js');
  const { setGewritRuntime } = await import('../src/modules/gewrit/runtime.js');
  const fake = createFakeDocuments([
    doc('412', 'Vitodens manual', { documentType: 'Manual' }),
    doc('413', 'Boiler invoice'),
  ]);
  if (provider) setGewritRuntime(fake);
  return { app: createApp(ALL_MODULES), fake };
}

type App = Awaited<ReturnType<typeof freshApp>>['app'];

async function newAsset(app: App, jwt: string): Promise<string> {
  const res = await app.request('/api/v1/ethel/assets', { method: 'POST', headers: authHeaders(jwt), body: JSON.stringify({ name: 'Boiler' }) });
  return ((await res.json()) as { data: { id: string } }).data.id;
}

async function link(app: App, jwt: string, body: Record<string, unknown>) {
  return app.request('/api/v1/gewrit/links', { method: 'POST', headers: authHeaders(jwt), body: JSON.stringify(body) });
}

async function linkedDocumentId(app: App, jwt: string, assetId: string, externalId = '412'): Promise<string> {
  const res = await link(app, jwt, { externalId, role: 'manual', assetId });
  expect(res.status).toBe(201);
  return ((await res.json()) as { data: { document: { id: string } } }).data.document.id;
}

describe('gewrit gating', () => {
  it('mounts nothing when GEWRIT_PROVIDER is blank', async () => {
    const { app } = await freshApp(null);
    const { adult } = await seedTestHousehold();
    const res = await app.request(`/api/v1/gewrit/assets/${UNKNOWN}/documents`, { headers: authHeaders(adult.jwt) });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('NOT_FOUND');
    const f = await app.request('/api/v1/features', { headers: authHeaders(adult.jwt) });
    expect(((await f.json()) as { data: { gewrit: boolean } }).data.gewrit).toBe(false);
  });

  it('reports gewrit enabled when a provider is set', async () => {
    const { app } = await freshApp('fake');
    const { adult } = await seedTestHousehold();
    const f = await app.request('/api/v1/features', { headers: authHeaders(adult.jwt) });
    expect(((await f.json()) as { data: { gewrit: boolean } }).data.gewrit).toBe(true);
  });
});

describe('gewrit roles', () => {
  it('refuses search and every write to a child, and lets a child read lists and previews', async () => {
    const { app } = await freshApp('fake');
    const { adult, child } = await seedTestHousehold();
    const assetId = await newAsset(app, adult.jwt);
    const documentId = await linkedDocumentId(app, adult.jwt, assetId);
    const list = await app.request(`/api/v1/gewrit/assets/${assetId}/documents`, { headers: authHeaders(adult.jwt) });
    const linkId = ((await list.json()) as { data: { id: string }[] }).data[0]!.id;

    expect((await app.request('/api/v1/gewrit/documents/search?q=boiler', { headers: authHeaders(child.jwt) })).status).toBe(403);
    expect((await link(app, child.jwt, { externalId: '413', role: 'invoice', assetId })).status).toBe(403);
    expect((await app.request(`/api/v1/gewrit/links/${linkId}`, { method: 'PATCH', headers: authHeaders(child.jwt), body: JSON.stringify({ note: 'x' }) })).status).toBe(403);
    expect((await app.request(`/api/v1/gewrit/links/${linkId}`, { method: 'DELETE', headers: authHeaders(child.jwt) })).status).toBe(403);

    expect((await app.request(`/api/v1/gewrit/assets/${assetId}/documents`, { headers: authHeaders(child.jwt) })).status).toBe(200);
    expect((await app.request(`/api/v1/gewrit/documents/${documentId}/preview`, { headers: authHeaders(child.jwt) })).status).toBe(200);
  });
});

describe('gewrit linking over REST', () => {
  it('links, lists with meta.stale, edits and deletes', async () => {
    const { app } = await freshApp('fake');
    const { adult } = await seedTestHousehold();
    const assetId = await newAsset(app, adult.jwt);
    const created = await link(app, adult.jwt, { externalId: '412', role: 'manual', note: '  drawer  ', assetId });
    expect(created.status).toBe(201);
    const view = ((await created.json()) as { data: { id: string; note: string; document: { title: string } } }).data;
    expect(view.note).toBe('drawer');
    expect(view.document.title).toBe('Vitodens manual');

    const list = await app.request(`/api/v1/gewrit/assets/${assetId}/documents`, { headers: authHeaders(adult.jwt) });
    const listBody = (await list.json()) as { data: unknown[]; meta: { stale: boolean; staleReason: string | null } };
    expect(listBody.data).toHaveLength(1);
    expect(listBody.meta.stale).toBe(false);
    expect(listBody.meta.staleReason).toBeNull();

    const patched = await app.request(`/api/v1/gewrit/links/${view.id}`, { method: 'PATCH', headers: authHeaders(adult.jwt), body: JSON.stringify({ role: 'warranty', note: '' }) });
    expect(((await patched.json()) as { data: { role: string; note: string | null } }).data).toMatchObject({ role: 'warranty', note: null });

    const deleted = await app.request(`/api/v1/gewrit/links/${view.id}`, { method: 'DELETE', headers: authHeaders(adult.jwt) });
    expect(((await deleted.json()) as { data: { id: string } }).data.id).toBe(view.id);
    expect((await app.request(`/api/v1/gewrit/links/${view.id}`, { method: 'DELETE', headers: authHeaders(adult.jwt) })).status).toBe(404);
  });

  it('validates before calling Paperless', async () => {
    const { app, fake } = await freshApp('fake');
    const { adult } = await seedTestHousehold();
    const assetId = await newAsset(app, adult.jwt);
    for (const body of [
      { externalId: 'abc', role: 'manual', assetId },
      { externalId: '0', role: 'manual', assetId },
      { externalId: '412', role: 'receipt', assetId },
      { externalId: '412', role: 'manual' },
      { externalId: '412', role: 'manual', assetId, placeId: assetId },
      { externalId: '412', role: 'manual', assetId, note: 'x'.repeat(501) },
    ]) {
      const res = await link(app, adult.jwt, body);
      expect(res.status).toBe(400);
    }
    expect((fake as FakeDocuments).calls.getMany).toHaveLength(0);
  });

  it('maps unknown element and document to 422, duplicates to 409', async () => {
    const { app } = await freshApp('fake');
    const { adult } = await seedTestHousehold();
    const assetId = await newAsset(app, adult.jwt);
    const code = async (r: Response) => ((await r.json()) as { error: { code: string } }).error.code;

    const noAsset = await link(app, adult.jwt, { externalId: '412', role: 'manual', assetId: UNKNOWN });
    expect([noAsset.status, await code(noAsset)]).toEqual([422, 'ELEMENT_NOT_FOUND']);
    const noDoc = await link(app, adult.jwt, { externalId: '999', role: 'manual', assetId });
    expect([noDoc.status, await code(noDoc)]).toEqual([422, 'DOCUMENT_NOT_FOUND']);
    await link(app, adult.jwt, { externalId: '412', role: 'manual', assetId });
    const dup = await link(app, adult.jwt, { externalId: '412', role: 'manual', assetId });
    expect([dup.status, await code(dup)]).toEqual([409, 'ALREADY_LINKED']);
  });

  it('maps an outage to 502 PROVIDER_UNAVAILABLE and a refused token to 502 PROVIDER_AUTH', async () => {
    const { app, fake } = await freshApp('fake');
    const { adult } = await seedTestHousehold();
    const assetId = await newAsset(app, adult.jwt);
    const code = async (r: Response) => ((await r.json()) as { error: { code: string } }).error.code;
    fake.failWith = 'unreachable';
    const down = await link(app, adult.jwt, { externalId: '412', role: 'manual', assetId });
    expect([down.status, await code(down)]).toEqual([502, 'PROVIDER_UNAVAILABLE']);
    fake.failWith = 'auth';
    const refused = await app.request('/api/v1/gewrit/documents/search?q=boiler', { headers: authHeaders(adult.jwt) });
    expect([refused.status, await code(refused)]).toEqual([502, 'PROVIDER_AUTH']);
  });

  it('lists meta.staleReason auth for a refused credential and unavailable for any other outage', async () => {
    const { app, fake } = await freshApp('fake');
    const { adult } = await seedTestHousehold();
    const assetId = await newAsset(app, adult.jwt);
    const documentId = await linkedDocumentId(app, adult.jwt, assetId);
    const backdate = () => db.update(gewritDocuments)
      .set({ lastSeenAt: new Date(Date.now() - 20 * 60_000) })
      .where(eq(gewritDocuments.id, documentId));
    const staleReason = async (failWith: FakeDocuments['failWith']) => {
      await backdate();
      fake.failWith = failWith;
      const res = await app.request(`/api/v1/gewrit/assets/${assetId}/documents`, { headers: authHeaders(adult.jwt) });
      return ((await res.json()) as { meta: { staleReason: string | null } }).meta.staleReason;
    };
    expect(await staleReason('auth')).toBe('auth');
    expect(await staleReason('timeout')).toBe('unavailable');
    expect(await staleReason('unreachable')).toBe('unavailable');
  });

  it('404s the list of an unknown element', async () => {
    const { app } = await freshApp('fake');
    const { adult } = await seedTestHousehold();
    const res = await app.request(`/api/v1/gewrit/places/${UNKNOWN}/documents`, { headers: authHeaders(adult.jwt) });
    expect(res.status).toBe(404);
  });
});

describe('gewrit search over REST', () => {
  it('needs 2 to 200 characters and returns text-only hits', async () => {
    const { app } = await freshApp('fake');
    const { adult } = await seedTestHousehold();
    expect((await app.request('/api/v1/gewrit/documents/search?q=a', { headers: authHeaders(adult.jwt) })).status).toBe(400);
    const res = await app.request('/api/v1/gewrit/documents/search?q=boiler', { headers: authHeaders(adult.jwt) });
    const hits = ((await res.json()) as { data: { externalId: string }[] }).data;
    expect(hits.map((h) => h.externalId)).toEqual(['413']);
    expect(Object.keys(hits[0]!).sort()).toEqual(['correspondent', 'createdOn', 'documentType', 'externalId', 'title']);
  });
});

describe('gewrit preview over REST', () => {
  it('streams an allowlisted type inline with the security headers and the forwarded length', async () => {
    const { app, fake } = await freshApp('fake');
    const { adult } = await seedTestHousehold();
    const documentId = await linkedDocumentId(app, adult.jwt, await newAsset(app, adult.jwt));
    fake.preview = { contentType: 'application/pdf', body: '%PDF-1.7 hello', contentLength: 14 };
    const res = await app.request(`/api/v1/gewrit/documents/${documentId}/preview`, { headers: authHeaders(adult.jwt) });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toBe('inline');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toBeNull();
    expect(res.headers.get('content-length')).toBe('14');
    expect(await res.text()).toBe('%PDF-1.7 hello');
  });

  it('serves HTML and a missing type as an octet-stream attachment, without a length it does not know', async () => {
    const { app, fake } = await freshApp('fake');
    const { adult } = await seedTestHousehold();
    const documentId = await linkedDocumentId(app, adult.jwt, await newAsset(app, adult.jwt));
    for (const contentType of ['text/html', null]) {
      fake.preview = { contentType, body: '<script>alert(1)</script>', contentLength: null };
      const res = await app.request(`/api/v1/gewrit/documents/${documentId}/preview`, { headers: authHeaders(adult.jwt) });
      expect(res.headers.get('content-type')).toBe('application/octet-stream');
      expect(res.headers.get('content-disposition')).toBe('attachment');
      expect(res.headers.get('content-length')).toBeNull();
    }
  });

  it('refuses an unknown or orphaned document without asking Paperless', async () => {
    const { app, fake } = await freshApp('fake');
    const { adult } = await seedTestHousehold();
    const assetId = await newAsset(app, adult.jwt);
    const documentId = await linkedDocumentId(app, adult.jwt, assetId);
    await app.request(`/api/v1/ethel/assets/${assetId}`, { method: 'DELETE', headers: authHeaders(adult.jwt) });
    expect((await app.request(`/api/v1/gewrit/documents/${documentId}/preview`, { headers: authHeaders(adult.jwt) })).status).toBe(404);
    expect((await app.request(`/api/v1/gewrit/documents/${UNKNOWN}/preview`, { headers: authHeaders(adult.jwt) })).status).toBe(404);
    expect(fake.calls.openPreview).toHaveLength(0);
  });

  it('marks a document missing when Paperless no longer has it', async () => {
    const { app, fake } = await freshApp('fake');
    const { adult } = await seedTestHousehold();
    const assetId = await newAsset(app, adult.jwt);
    const documentId = await linkedDocumentId(app, adult.jwt, assetId);
    fake.docs.delete('412');
    expect((await app.request(`/api/v1/gewrit/documents/${documentId}/preview`, { headers: authHeaders(adult.jwt) })).status).toBe(404);
    const list = await app.request(`/api/v1/gewrit/assets/${assetId}/documents`, { headers: authHeaders(adult.jwt) });
    expect(((await list.json()) as { data: { document: { status: string } }[] }).data[0]!.document.status).toBe('missing');
  });

  it('hands the request signal to the provider so a closed preview aborts upstream', async () => {
    const { app, fake } = await freshApp('fake');
    const { adult } = await seedTestHousehold();
    const documentId = await linkedDocumentId(app, adult.jwt, await newAsset(app, adult.jwt));
    const ctrl = new AbortController();
    await app.request(new Request(`http://localhost/api/v1/gewrit/documents/${documentId}/preview`, { headers: authHeaders(adult.jwt), signal: ctrl.signal }));
    const signal = fake.calls.signals[0];
    expect(signal).toBeDefined();
    ctrl.abort();
    expect(signal!.aborted).toBe(true);
  });
});

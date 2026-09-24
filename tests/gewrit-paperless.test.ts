import { describe, it, expect } from 'vitest';
import { createPaperlessProvider, PAPERLESS_API_VERSION } from '../src/modules/gewrit/providers/paperless.js';
import { isDocumentProviderError } from '../src/modules/gewrit/providers/types.js';

const TOKEN = 'secret-token-123';
const cfg = { provider: 'paperless' as const, baseUrl: 'http://paperless:8000/', token: TOKEN, publicUrl: 'https://paperless.home/' };

interface Call { url: URL; headers: Headers; signal: AbortSignal | undefined }
type Handler = (url: URL, signal: AbortSignal | undefined) => Response | Promise<Response>;

function stub(handler: Handler) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const signal = init?.signal ?? undefined;
    calls.push({ url, headers: new Headers(init?.headers), signal });
    return handler(url, signal);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const page = (results: unknown[]) => json({ count: results.length, next: null, previous: null, results });

const PAPERLESS_DOCS = [
  { id: 412, title: 'Vitodens manual', document_type: 3, correspondent: 7, created: '2019-03-11T00:00:00+01:00' },
  { id: 413, title: 'Untyped scan', document_type: null, correspondent: null, created: '2020-01-02' },
];

function standard(url: URL): Response {
  if (url.pathname === '/api/document_types/') return page([{ id: 3, name: 'Manual' }]);
  if (url.pathname === '/api/correspondents/') return page([{ id: 7, name: 'Viessmann' }]);
  if (url.pathname === '/api/documents/') return page(PAPERLESS_DOCS);
  return new Response('nope', { status: 404 });
}

async function reasonOf(p: Promise<unknown>): Promise<string> {
  const e = await p.then(() => null, (x: unknown) => x);
  if (!isDocumentProviderError(e)) throw new Error(`expected a DocumentProviderError, got ${String(e)}`);
  expect(e.message).not.toContain(TOKEN);
  expect(JSON.stringify(e)).not.toContain(TOKEN);
  return e.reason;
}

describe('paperless provider — metadata', () => {
  it('batches ids with id__in, pins the API version, sends the token, and maps names and dates', async () => {
    const { fetchImpl, calls } = stub(standard);
    const p = createPaperlessProvider(cfg, { fetchImpl });
    const docs = await p.getMany(['412', '413']);

    const docCall = calls.find((c) => c.url.pathname === '/api/documents/')!;
    expect(docCall.url.origin).toBe('http://paperless:8000');
    expect(docCall.url.searchParams.get('id__in')).toBe('412,413');
    expect(docCall.url.searchParams.get('page_size')).toBe('2');
    for (const c of calls) {
      expect(c.headers.get('authorization')).toBe(`Token ${TOKEN}`);
      expect(c.headers.get('accept')).toBe(`application/json; version=${PAPERLESS_API_VERSION}`);
    }
    expect(docs).toEqual([
      { externalId: '412', title: 'Vitodens manual', documentType: 'Manual', correspondent: 'Viessmann', createdOn: '2019-03-11' },
      { externalId: '413', title: 'Untyped scan', documentType: null, correspondent: null, createdOn: '2020-01-02' },
    ]);
  });

  it('makes no call for an empty id list and drops ids that are not Paperless ids', async () => {
    const { fetchImpl, calls } = stub(standard);
    const p = createPaperlessProvider(cfg, { fetchImpl });
    expect(await p.getMany([])).toEqual([]);
    expect(await p.getMany(['abc', '0', '../1'])).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('skips the name lookups when no document has a type or correspondent', async () => {
    const { fetchImpl, calls } = stub((url) =>
      url.pathname === '/api/documents/' ? page([PAPERLESS_DOCS[1]]) : standard(url));
    await createPaperlessProvider(cfg, { fetchImpl }).getMany(['413']);
    expect(calls.map((c) => c.url.pathname)).toEqual(['/api/documents/']);
  });

  it('caches type and correspondent names for ten minutes', async () => {
    let now = 1_000_000;
    const { fetchImpl, calls } = stub(standard);
    const p = createPaperlessProvider(cfg, { fetchImpl, now: () => now });
    await p.getMany(['412']);
    await p.getMany(['412']);
    expect(calls.filter((c) => c.url.pathname === '/api/document_types/')).toHaveLength(1);
    now += 11 * 60 * 1000;
    await p.getMany(['412']);
    expect(calls.filter((c) => c.url.pathname === '/api/document_types/')).toHaveLength(2);
  });

  it('degrades a name the heorth user cannot see to null, and does not cache the failure', async () => {
    const { fetchImpl, calls } = stub((url) =>
      url.pathname === '/api/correspondents/' ? new Response('', { status: 403 }) : standard(url));
    const p = createPaperlessProvider(cfg, { fetchImpl });
    const [d] = await p.getMany(['412']);
    expect(d).toMatchObject({ documentType: 'Manual', correspondent: null });
    await p.getMany(['412']);
    expect(calls.filter((c) => c.url.pathname === '/api/correspondents/')).toHaveLength(2);
  });

  it('passes search text through as ONE query parameter, with the limit as page_size', async () => {
    const { fetchImpl, calls } = stub(standard);
    await createPaperlessProvider(cfg, { fetchImpl }).search('Rechnung & Garantie #2', 25);
    const c = calls.find((x) => x.url.pathname === '/api/documents/')!;
    expect(c.url.searchParams.get('query')).toBe('Rechnung & Garantie #2*');
    expect(c.url.searchParams.get('page_size')).toBe('25');
    expect([...c.url.searchParams.keys()].sort()).toEqual(['page_size', 'query']);
  });

  it('matches the last word as a prefix, so typing "Tel" finds "Telekom"', async () => {
    for (const [typed, sent] of [
      ['Tel', 'Tel*'],
      ['Telekom Rech', 'Telekom Rech*'],
      ['Bestätig', 'Bestätig*'],
      ['Tel*', 'Tel*'],
      ['"Telekom Hilfe"', '"Telekom Hilfe"'],
      ['(Telekom OR Vodafone)', '(Telekom OR Vodafone)'],
    ] as const) {
      const { fetchImpl, calls } = stub(standard);
      await createPaperlessProvider(cfg, { fetchImpl }).search(typed, 25);
      expect(calls.find((x) => x.url.pathname === '/api/documents/')!.url.searchParams.get('query')).toBe(sent);
    }
  });
});

describe('paperless provider — failures', () => {
  it('maps 401 and 403 to auth, 500 to upstream', async () => {
    for (const [status, reason] of [[401, 'auth'], [403, 'auth'], [500, 'upstream']] as const) {
      const { fetchImpl } = stub(() => new Response('secret-token-123 leaked?', { status }));
      expect(await reasonOf(createPaperlessProvider(cfg, { fetchImpl }).search('x', 5))).toBe(reason);
    }
  });

  it('maps a network failure to unreachable and non-JSON to upstream', async () => {
    const down = stub(() => { throw new TypeError('fetch failed'); });
    expect(await reasonOf(createPaperlessProvider(cfg, { fetchImpl: down.fetchImpl }).search('x', 5))).toBe('unreachable');
    const html = stub(() => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    expect(await reasonOf(createPaperlessProvider(cfg, { fetchImpl: html.fetchImpl }).search('x', 5))).toBe('upstream');
  });

  it('cancels the body of a failed JSON response so the connection can be reused', async () => {
    let cancelled = false;
    const { fetchImpl } = stub(() => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 500 }));
    await reasonOf(createPaperlessProvider(cfg, { fetchImpl }).search('x', 5));
    expect(cancelled).toBe(true);
  });

  it('maps a timeout to timeout, honouring timeoutMs', async () => {
    const { fetchImpl } = stub((_url, signal) => new Promise<Response>((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(signal.reason));
    }));
    expect(await reasonOf(createPaperlessProvider(cfg, { fetchImpl }).getMany(['412'], { timeoutMs: 20 }))).toBe('timeout');
  });
});

describe('paperless provider — preview', () => {
  it('asks for the preview with identity encoding and passes type and length through', async () => {
    const { fetchImpl, calls } = stub(() => new Response('%PDF-1.7', {
      status: 200, headers: { 'content-type': 'application/pdf', 'content-length': '8' },
    }));
    const s = await createPaperlessProvider(cfg, { fetchImpl }).openPreview('412');
    expect(calls[0]!.url.pathname).toBe('/api/documents/412/preview/');
    expect(calls[0]!.headers.get('accept-encoding')).toBe('identity');
    expect(calls[0]!.headers.get('authorization')).toBe(`Token ${TOKEN}`);
    expect(s.contentType).toBe('application/pdf');
    expect(s.contentLength).toBe(8);
    expect(await new Response(s.body).text()).toBe('%PDF-1.7');
  });

  it('drops the length of a content-encoded body and of a body without one', async () => {
    const gz = stub(() => new Response('x', { status: 200, headers: { 'content-type': 'application/pdf', 'content-length': '999', 'content-encoding': 'gzip' } }));
    expect((await createPaperlessProvider(cfg, { fetchImpl: gz.fetchImpl }).openPreview('412')).contentLength).toBeNull();
    const none = stub(() => new Response('x', { status: 200, headers: { 'content-type': 'application/pdf' } }));
    expect((await createPaperlessProvider(cfg, { fetchImpl: none.fetchImpl }).openPreview('412')).contentLength).toBeNull();
  });

  it('times out when headers arrive but the first body chunk does not', async () => {
    const { fetchImpl } = stub((_url, signal) => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        // Headers are "sent"; the body stalls until the provider gives up.
        signal?.addEventListener('abort', () => controller.error(signal.reason));
      },
    }), { status: 200, headers: { 'content-type': 'application/pdf' } }));
    const p = createPaperlessProvider(cfg, { fetchImpl, firstByteTimeoutMs: 20 });
    expect(await reasonOf(p.openPreview('412'))).toBe('timeout');
  });

  it('does not time out a slow body once the first chunk has arrived', async () => {
    const { fetchImpl } = stub(() => new Response(new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(new TextEncoder().encode('%PDF'));
        await new Promise((r) => setTimeout(r, 60));
        controller.enqueue(new TextEncoder().encode('-1.7'));
        controller.close();
      },
    }), { status: 200, headers: { 'content-type': 'application/pdf' } }));
    const s = await createPaperlessProvider(cfg, { fetchImpl, firstByteTimeoutMs: 20 }).openPreview('412');
    expect(await new Response(s.body).text()).toBe('%PDF-1.7');
  });

  it('maps 404 to not_found and refuses an invalid id without a call', async () => {
    const { fetchImpl, calls } = stub(() => new Response('', { status: 404 }));
    const p = createPaperlessProvider(cfg, { fetchImpl });
    expect(await reasonOf(p.openPreview('412'))).toBe('not_found');
    expect(await reasonOf(p.openPreview('../etc'))).toBe('not_found');
    expect(calls).toHaveLength(1);
  });

  it('aborts the upstream request when the caller aborts', async () => {
    const { fetchImpl, calls } = stub(() => new Response('x', { status: 200, headers: { 'content-type': 'application/pdf' } }));
    const ctrl = new AbortController();
    await createPaperlessProvider(cfg, { fetchImpl }).openPreview('412', { signal: ctrl.signal });
    expect(calls[0]!.signal!.aborted).toBe(false);
    ctrl.abort();
    expect(calls[0]!.signal!.aborted).toBe(true);
  });

  it('builds the external link from the public URL', () => {
    const { fetchImpl } = stub(standard);
    expect(createPaperlessProvider(cfg, { fetchImpl }).externalUrl('412')).toBe('https://paperless.home/documents/412/details');
  });
});

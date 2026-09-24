import type { GewritConfig } from '../../../config/env.js';
import {
  DocumentProviderError, isDocumentProviderError,
  type DocumentMeta, type DocumentProvider, type DocumentStream,
} from './types.js';

/**
 * Paperless-ngx REST implementation (ADR 0017). The ONLY file where Paperless
 * URLs, JSON shapes and the token appear. Read-only: GETs only.
 *
 * The API version is pinned because an unpinned client gets whatever version
 * the server defaults to, which can change the response shape on an upgrade.
 * 10 is the current Paperless API version (docs.paperless-ngx.com/api, "API
 * versioning"); a server whose maximum is lower answers 406, which surfaces as
 * PROVIDER_UNAVAILABLE. Raise it deliberately, after reading the changelog.
 */
export const PAPERLESS_API_VERSION = 10;

const JSON_TIMEOUT_MS = 8000;
const FIRST_BYTE_TIMEOUT_MS = 8000;
const TAXONOMY_TTL_MS = 10 * 60 * 1000;
const ID_RE = /^[1-9][0-9]{0,9}$/;

type PaperlessConfig = Extract<GewritConfig, { provider: 'paperless' }>;

export interface PaperlessOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Test seam; production uses 8 s. */
  firstByteTimeoutMs?: number;
}

interface PaperlessDocument {
  id: number;
  title: string;
  documentType: number | null;
  correspondent: number | null;
  created: string | null;
}

interface Taxonomy {
  types: Map<number, string>;
  correspondents: Map<number, string>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function results(body: unknown): unknown[] {
  if (!isRecord(body) || !Array.isArray(body['results'])) {
    throw new DocumentProviderError('upstream', 'Paperless answered an unexpected shape');
  }
  return body['results'];
}

function parseDocument(v: unknown): PaperlessDocument {
  if (!isRecord(v) || typeof v['id'] !== 'number' || typeof v['title'] !== 'string') {
    throw new DocumentProviderError('upstream', 'Paperless answered a malformed document');
  }
  const num = (x: unknown) => (typeof x === 'number' ? x : null);
  return {
    id: v['id'],
    title: v['title'],
    documentType: num(v['document_type']),
    correspondent: num(v['correspondent']),
    created: typeof v['created'] === 'string' ? v['created'] : null,
  };
}

function statusError(status: number): DocumentProviderError {
  if (status === 401 || status === 403) return new DocumentProviderError('auth', `Paperless answered ${status}`);
  if (status === 404) return new DocumentProviderError('not_found', 'Paperless answered 404');
  return new DocumentProviderError('upstream', `Paperless answered ${status}`);
}

/** Never includes the thrown value's message: it may echo a URL. */
function classify(e: unknown): DocumentProviderError {
  if (isDocumentProviderError(e)) return e;
  if (e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
    return new DocumentProviderError('timeout', 'Paperless did not answer in time');
  }
  if (e instanceof TypeError) return new DocumentProviderError('unreachable', 'Paperless unreachable');
  return new DocumentProviderError('upstream', 'Paperless request failed');
}

export function createPaperlessProvider(cfg: PaperlessConfig, o: PaperlessOptions = {}): DocumentProvider {
  const fetchImpl = o.fetchImpl ?? fetch;
  const now = o.now ?? Date.now;
  const firstByteTimeoutMs = o.firstByteTimeoutMs ?? FIRST_BYTE_TIMEOUT_MS;
  const base = cfg.baseUrl.replace(/\/+$/, '');
  const publicBase = cfg.publicUrl.replace(/\/+$/, '');
  const authorization = `Token ${cfg.token}`;
  let cached: { at: number; value: Taxonomy } | null = null;

  async function getJson(path: string, timeoutMs: number): Promise<unknown> {
    try {
      const res = await fetchImpl(`${base}${path}`, {
        headers: { Authorization: authorization, Accept: `application/json; version=${PAPERLESS_API_VERSION}` },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        // Undici only reuses the connection once the body is consumed or
        // cancelled; a stream of 401s would otherwise pin sockets.
        await res.body?.cancel().catch(() => undefined);
        throw statusError(res.status);
      }
      return await res.json();
    } catch (e) {
      throw classify(e);
    }
  }

  async function names(path: string, timeoutMs: number): Promise<Map<number, string>> {
    const out = new Map<number, string>();
    for (const r of results(await getJson(path, timeoutMs))) {
      if (isRecord(r) && typeof r['id'] === 'number' && typeof r['name'] === 'string') out.set(r['id'], r['name']);
    }
    return out;
  }

  /** Each half degrades on its own to an empty map (names become null). Only
   *  a fully successful lookup is cached, so a permission fix shows up on the
   *  next call rather than after ten minutes. */
  async function taxonomy(timeoutMs: number): Promise<Taxonomy> {
    if (cached && now() - cached.at < TAXONOMY_TTL_MS) return cached.value;
    const [types, correspondents] = await Promise.allSettled([
      names('/api/document_types/?page_size=1000', timeoutMs),
      names('/api/correspondents/?page_size=1000', timeoutMs),
    ]);
    const value: Taxonomy = {
      types: types.status === 'fulfilled' ? types.value : new Map(),
      correspondents: correspondents.status === 'fulfilled' ? correspondents.value : new Map(),
    };
    if (types.status === 'fulfilled' && correspondents.status === 'fulfilled') cached = { at: now(), value };
    return value;
  }

  async function toMeta(raw: unknown[], timeoutMs: number): Promise<DocumentMeta[]> {
    const docs = raw.map(parseDocument);
    const needsNames = docs.some((d) => d.documentType !== null || d.correspondent !== null);
    const t = needsNames ? await taxonomy(timeoutMs) : null;
    return docs.map((d) => ({
      externalId: String(d.id),
      title: d.title,
      documentType: d.documentType !== null ? t?.types.get(d.documentType) ?? null : null,
      correspondent: d.correspondent !== null ? t?.correspondents.get(d.correspondent) ?? null : null,
      // Works whether the server sends a date or a datetime.
      createdOn: d.created ? d.created.slice(0, 10) : null,
    }));
  }

  return {
    id: 'paperless',

    async search(query, limit) {
      const qs = new URLSearchParams({ query, page_size: String(limit) });
      return toMeta(results(await getJson(`/api/documents/?${qs}`, JSON_TIMEOUT_MS)), JSON_TIMEOUT_MS);
    },

    async getMany(externalIds, opts = {}) {
      const ids = externalIds.filter((id) => ID_RE.test(id));
      if (ids.length === 0) return [];
      const timeoutMs = opts.timeoutMs ?? JSON_TIMEOUT_MS;
      const qs = new URLSearchParams({ id__in: ids.join(','), page_size: String(ids.length) });
      return toMeta(results(await getJson(`/api/documents/?${qs}`, timeoutMs)), timeoutMs);
    },

    async openPreview(externalId, opts = {}): Promise<DocumentStream> {
      if (!ID_RE.test(externalId)) throw new DocumentProviderError('not_found', 'not a Paperless document id');
      // The timeout covers the FIRST BODY CHUNK, not just the headers — fetch
      // resolves as soon as headers arrive. It is cleared after that chunk, so
      // a large PDF is never cut off mid-stream (an AbortSignal.timeout would).
      const firstByte = new AbortController();
      const timer = setTimeout(
        () => firstByte.abort(new DOMException('first byte timeout', 'TimeoutError')),
        firstByteTimeoutMs,
      );
      const signal = opts.signal ? AbortSignal.any([firstByte.signal, opts.signal]) : firstByte.signal;
      let res: Response;
      try {
        res = await fetchImpl(`${base}/api/documents/${externalId}/preview/`, {
          // identity: Node's fetch decodes a compressed body but keeps the
          // compressed Content-Length (undici #2514).
          headers: { Authorization: authorization, 'Accept-Encoding': 'identity' },
          signal,
        });
      } catch (e) {
        clearTimeout(timer);
        throw classify(e);
      }
      if (!res.ok || !res.body) {
        clearTimeout(timer);
        await res.body?.cancel().catch(() => undefined);
        throw statusError(res.ok ? 502 : res.status);
      }
      const reader = res.body.getReader();
      let first: Awaited<ReturnType<typeof reader.read>>;
      try {
        first = await reader.read();
      } catch (e) {
        throw classify(e);
      } finally {
        clearTimeout(timer);
      }
      // Replay the first chunk, then pipe the rest. cancel() reaches upstream,
      // so a member closing the preview stops the Paperless download.
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          if (first.done) controller.close();
          else controller.enqueue(first.value);
        },
        async pull(controller) {
          const next = await reader.read();
          if (next.done) controller.close();
          else controller.enqueue(next.value);
        },
        cancel(reason) {
          return reader.cancel(reason);
        },
      });
      const rawLength = res.headers.get('content-length');
      const length = rawLength === null ? NaN : Number(rawLength);
      return {
        body,
        contentType: res.headers.get('content-type'),
        contentLength: !res.headers.has('content-encoding') && Number.isSafeInteger(length) && length >= 0 ? length : null,
      };
    },

    externalUrl(externalId) {
      return `${publicBase}/documents/${externalId}/details`;
    },
  };
}

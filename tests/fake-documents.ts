import type { DocumentMeta, DocumentProvider, DocumentErrorReason, DocumentStream } from '../src/modules/gewrit/providers/types.js';

/**
 * In-memory DocumentProvider for Gewrit tests. Mutable on purpose: tests change
 * `docs` to simulate edits and deletions in Paperless, set `failWith` for an
 * outage, and read `calls` to prove a path made (or skipped) a provider call.
 *
 * Errors are plain Errors carrying name + reason, not the src class, so they are
 * recognised by `isDocumentProviderError` in ANY module graph (the gating tests
 * use vi.resetModules()).
 */
export interface FakeDocuments extends DocumentProvider {
  docs: Map<string, DocumentMeta>;
  failWith: DocumentErrorReason | null;
  preview: { contentType: string | null; body: string; contentLength: number | null };
  calls: { search: string[]; getMany: string[][]; openPreview: string[]; signals: (AbortSignal | undefined)[]; timeouts: (number | undefined)[] };
  /** Runs inside getMany before it answers — lets a test force a race. */
  beforeGetMany: (() => Promise<void>) | null;
}

export function doc(externalId: string, title = `Document ${externalId}`, extra: Partial<DocumentMeta> = {}): DocumentMeta {
  return { externalId, title, documentType: null, correspondent: null, createdOn: null, ...extra };
}

function failure(reason: DocumentErrorReason): Error {
  const e = new Error(reason) as Error & { reason: DocumentErrorReason };
  e.name = 'DocumentProviderError';
  e.reason = reason;
  return e;
}

export function createFakeDocuments(initial: DocumentMeta[] = []): FakeDocuments {
  const fake: FakeDocuments = {
    id: 'paperless',
    docs: new Map(initial.map((d) => [d.externalId, d])),
    failWith: null,
    preview: { contentType: 'application/pdf', body: '%PDF-1.4 fake', contentLength: null },
    calls: { search: [], getMany: [], openPreview: [], signals: [], timeouts: [] },
    beforeGetMany: null,
    async search(query, limit) {
      fake.calls.search.push(query);
      if (fake.failWith) throw failure(fake.failWith);
      return [...fake.docs.values()].filter((d) => d.title.toLowerCase().includes(query.toLowerCase())).slice(0, limit);
    },
    async getMany(ids, opts) {
      fake.calls.getMany.push([...ids]);
      fake.calls.timeouts.push(opts?.timeoutMs);
      if (fake.beforeGetMany) await fake.beforeGetMany();
      if (fake.failWith) throw failure(fake.failWith);
      return ids.flatMap((id) => (fake.docs.has(id) ? [fake.docs.get(id)!] : []));
    },
    async openPreview(id, opts): Promise<DocumentStream> {
      fake.calls.openPreview.push(id);
      fake.calls.signals.push(opts?.signal);
      if (fake.failWith) throw failure(fake.failWith);
      if (!fake.docs.has(id)) throw failure('not_found');
      const bytes = new TextEncoder().encode(fake.preview.body);
      return {
        body: new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } }),
        contentType: fake.preview.contentType,
        contentLength: fake.preview.contentLength,
      };
    },
    externalUrl(id) {
      return `https://paperless.test/documents/${id}/details`;
    },
  };
  return fake;
}

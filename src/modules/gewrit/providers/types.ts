import type { DocumentSource } from '../schema.js';

/**
 * Provider-agnostic contract for a document system of record (ADR 0017).
 * No Paperless type, URL or error body crosses this file. Read-only by design:
 * Heorth never creates, edits or deletes a document upstream.
 */

export interface DocumentMeta {
  /** The provider's document id, as a decimal string. */
  externalId: string;
  title: string;
  documentType: string | null;
  correspondent: string | null;
  /** The document's own date, YYYY-MM-DD. */
  createdOn: string | null;
}

export interface DocumentStream {
  body: ReadableStream<Uint8Array>;
  /** As the provider reported it; the route decides what to serve. */
  contentType: string | null;
  /** Null when unknown OR when the upstream body was content-encoded — a
   *  forwarded compressed length would truncate the decoded stream. */
  contentLength: number | null;
}

export type DocumentErrorReason = 'unreachable' | 'timeout' | 'auth' | 'not_found' | 'upstream';

/** The only error a provider throws. The message is fixed text and never
 *  contains a token, URL or upstream body. */
export class DocumentProviderError extends Error {
  constructor(public readonly reason: DocumentErrorReason, message?: string) {
    super(message ?? reason);
    this.name = 'DocumentProviderError';
  }
}

/**
 * Duck-typed on purpose, never `instanceof`: the gating tests load the app in a
 * fresh module graph (vi.resetModules), where a class from the static graph is
 * a different constructor.
 */
export function isDocumentProviderError(e: unknown): e is DocumentProviderError {
  return e instanceof Error && e.name === 'DocumentProviderError' && typeof (e as { reason?: unknown }).reason === 'string';
}

export interface DocumentProvider {
  readonly id: DocumentSource;
  /** Full-text search. At most `limit` hits, in the provider's relevance order. */
  search(query: string, limit: number): Promise<DocumentMeta[]>;
  /** Metadata for the given ids. Ids the provider does not return are absent. */
  getMany(externalIds: string[], opts?: { timeoutMs?: number }): Promise<DocumentMeta[]>;
  /** The inline preview (archived PDF, else original). `signal` aborts upstream. */
  openPreview(externalId: string, opts?: { signal?: AbortSignal }): Promise<DocumentStream>;
  /** The link for "Open in Paperless", or null when there is no UI to open. */
  externalUrl(externalId: string): string | null;
}

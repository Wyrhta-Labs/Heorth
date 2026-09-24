/**
 * Response headers for a streamed preview (ADR 0017). The content-type
 * allowlist is THE protection for Heorth's origin: the web renders previews
 * from a blob: URL, which takes the page's origin and none of these headers, so
 * a CSP here would protect nothing and is deliberately not set. Anything not on
 * the list is served as a download and never rendered.
 */
export const INLINE_TYPES: ReadonlySet<string> = new Set([
  'application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp',
]);

export function previewHeaders(doc: { contentType: string | null; contentLength: number | null }): Headers {
  const essence = (doc.contentType ?? '').split(';')[0]!.trim().toLowerCase();
  const inline = INLINE_TYPES.has(essence);
  const h = new Headers();
  h.set('Content-Type', inline ? essence : 'application/octet-stream');
  h.set('Content-Disposition', inline ? 'inline' : 'attachment');
  h.set('Cache-Control', 'private, no-store');
  h.set('X-Content-Type-Options', 'nosniff');
  if (doc.contentLength !== null) h.set('Content-Length', String(doc.contentLength));
  return h;
}

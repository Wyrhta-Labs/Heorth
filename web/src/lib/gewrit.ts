import type { GewritElement, GewritLinkRole } from './types';

/** Mirrors Heorth's LINK_ROLES (src/modules/gewrit/schema.ts) — also the order
 *  the panel groups by. */
export const LINK_ROLES: readonly GewritLinkRole[] = ['manual', 'warranty', 'invoice', 'contract', 'certificate', 'other'];

const ID = /^[1-9][0-9]{0,9}$/;

/**
 * A pasted Paperless reference → the document id, or null. Accepts a bare
 * number or an absolute URL whose path contains `/documents/<id>` (a sub-path
 * install works). Anything else is refused here rather than posted.
 */
export function parsePaperlessRef(input: string): string | null {
  const s = input.trim();
  if (ID.test(s)) return s;
  let path: string;
  try {
    path = new URL(s).pathname;
  } catch {
    return null;
  }
  const m = /\/documents\/([1-9][0-9]{0,9})(?:\/|$)/.exec(path);
  return m ? m[1]! : null;
}

export type PreviewKind = 'pdf' | 'image' | 'download';

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/** The second half of the server's allowlist (src/modules/gewrit/preview.ts):
 *  the UI decides again from the blob's own type and never renders anything
 *  else. */
export function previewKind(type: string): PreviewKind {
  const t = type.split(';')[0]!.trim().toLowerCase();
  if (t === 'application/pdf') return 'pdf';
  if (IMAGE_TYPES.has(t)) return 'image';
  return 'download';
}

export function elementKey(el: GewritElement): string {
  return 'assetId' in el ? `asset:${el.assetId}` : `place:${el.placeId}`;
}

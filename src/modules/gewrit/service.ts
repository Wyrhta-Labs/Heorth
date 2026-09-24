import { and, eq, sql } from 'drizzle-orm';
import { pgErrorCode } from '@wyrhta/core/db';
import { db } from '../../db/index.js';
import { ethelAssets, ethelPlaces } from '../ethel/schema.js';
import { gewritDocuments, gewritLinks, LINK_ROLES, type GewritDocument, type GewritLink, type LinkRole } from './schema.js';
import { isDocumentProviderError, type DocumentMeta, type DocumentProvider } from './providers/types.js';

/**
 * Gewrit (ADR 0017). Reads Ethel's tables for existence only; the dependency
 * runs gewrit -> ethel, never the reverse. Paperless is the system of record:
 * the snapshot here is refreshed on read and never wins over it.
 */

export const REFRESH_AFTER_MS = 15 * 60 * 1000;
export const REFRESH_TIMEOUT_MS = 3000;
export const SEARCH_LIMIT = 25;

export type ElementRef = { assetId: string; placeId?: undefined } | { placeId: string; assetId?: undefined };

export type GewritErrorCode = 'ELEMENT_NOT_FOUND' | 'DOCUMENT_NOT_FOUND' | 'ALREADY_LINKED';

export class GewritError extends Error {
  constructor(public readonly code: GewritErrorCode, message: string) {
    super(message);
    this.name = 'GewritError';
  }
}

export interface DocumentView {
  id: string;
  externalId: string;
  title: string;
  documentType: string | null;
  correspondent: string | null;
  createdOn: string | null;
  status: 'available' | 'missing';
  lastSeenAt: Date;
  externalUrl: string | null;
}

export interface LinkView {
  id: string;
  role: LinkRole;
  note: string | null;
  createdAt: Date;
  document: DocumentView;
}

export interface CreateLinkInput {
  externalId: string;
  role: LinkRole;
  note?: string | null;
  assetId?: string;
  placeId?: string;
}

function documentView(provider: DocumentProvider, d: GewritDocument): DocumentView {
  return {
    id: d.id,
    externalId: d.externalId,
    title: d.title,
    documentType: d.documentType,
    correspondent: d.correspondent,
    createdOn: d.createdOn,
    status: d.status as DocumentView['status'],
    lastSeenAt: d.lastSeenAt,
    externalUrl: d.source === provider.id ? provider.externalUrl(d.externalId) : null,
  };
}

function linkView(provider: DocumentProvider, l: GewritLink, d: GewritDocument): LinkView {
  return { id: l.id, role: l.role as LinkRole, note: l.note, createdAt: l.createdAt, document: documentView(provider, d) };
}

const ROLE_ORDER = new Map<string, number>(LINK_ROLES.map((r, i) => [r, i]));

function sortViews(views: LinkView[]): LinkView[] {
  return views.sort((a, b) =>
    (ROLE_ORDER.get(a.role)! - ROLE_ORDER.get(b.role)!) || a.document.title.localeCompare(b.document.title));
}

function snapshot(m: DocumentMeta) {
  return { title: m.title, documentType: m.documentType, correspondent: m.correspondent, createdOn: m.createdOn };
}

async function elementExists(el: ElementRef): Promise<boolean> {
  const rows = el.assetId !== undefined
    ? await db.select({ id: ethelAssets.id }).from(ethelAssets).where(eq(ethelAssets.id, el.assetId))
    : await db.select({ id: ethelPlaces.id }).from(ethelPlaces).where(eq(ethelPlaces.id, el.placeId));
  return rows.length > 0;
}

function linkRows(el: ElementRef) {
  return db.select({ link: gewritLinks, document: gewritDocuments })
    .from(gewritLinks)
    .innerJoin(gewritDocuments, eq(gewritLinks.documentId, gewritDocuments.id))
    .where(el.assetId !== undefined ? eq(gewritLinks.assetId, el.assetId) : eq(gewritLinks.placeId, el.placeId));
}

/**
 * Removes document rows an Ethel cascade left without links. The one-hour age
 * guard keeps it off a row a concurrent createLink has just upserted but not
 * yet linked: the upsert sets updated_at, and a DELETE that waited on the row
 * lock re-checks that column on the new row version.
 */
export async function sweepOrphans(): Promise<void> {
  await db.execute(sql`
    DELETE FROM gewrit_documents d
     WHERE NOT EXISTS (SELECT 1 FROM gewrit_links l WHERE l.document_id = d.id)
       AND d.updated_at < now() - interval '1 hour'`);
}

/** Returns whether the provider could NOT be asked (the response's `stale`),
 *  and whether any row changed. */
async function refresh(provider: DocumentProvider, docs: GewritDocument[]): Promise<{ stale: boolean; changed: boolean }> {
  const cutoff = Date.now() - REFRESH_AFTER_MS;
  const due = docs.filter((d) => d.source === provider.id && d.lastSeenAt.getTime() < cutoff);
  if (due.length === 0) return { stale: false, changed: false };
  let metas: DocumentMeta[];
  try {
    metas = await provider.getMany(due.map((d) => d.externalId), { timeoutMs: REFRESH_TIMEOUT_MS });
  } catch (e) {
    if (isDocumentProviderError(e)) return { stale: true, changed: false };
    throw e;
  }
  const byId = new Map(metas.map((m) => [m.externalId, m]));
  const now = new Date();
  for (const d of due) {
    const m = byId.get(d.externalId);
    // A missing row keeps its old last_seen_at, so it is due again on the next
    // read and comes back by itself when Paperless returns it.
    await db.update(gewritDocuments)
      .set(m
        ? { ...snapshot(m), status: 'available', lastSeenAt: now, updatedAt: now }
        : { status: 'missing', updatedAt: now })
      .where(eq(gewritDocuments.id, d.id));
  }
  return { stale: false, changed: true };
}

export async function listForElement(
  provider: DocumentProvider, el: ElementRef,
): Promise<{ links: LinkView[]; stale: boolean } | null> {
  if (!(await elementExists(el))) return null;
  await sweepOrphans();
  let rows = await linkRows(el);
  const docs = [...new Map(rows.map((r) => [r.document.id, r.document])).values()];
  const r = await refresh(provider, docs);
  if (r.changed) rows = await linkRows(el);
  return { links: sortViews(rows.map((x) => linkView(provider, x.link, x.document))), stale: r.stale };
}

export async function createLink(provider: DocumentProvider, input: CreateLinkInput): Promise<LinkView> {
  const el: ElementRef = input.assetId !== undefined ? { assetId: input.assetId } : { placeId: input.placeId! };
  if (!(await elementExists(el))) throw new GewritError('ELEMENT_NOT_FOUND', 'That asset or place does not exist');
  // Outside the transaction on purpose: no lock is held across a network call.
  // Provider errors propagate to the route.
  const [meta] = await provider.getMany([input.externalId]);
  if (!meta) throw new GewritError('DOCUMENT_NOT_FOUND', 'Paperless has no document with that id');
  try {
    return await db.transaction(async (tx) => {
      const now = new Date();
      const [d] = await tx.insert(gewritDocuments)
        .values({ source: provider.id, externalId: input.externalId, ...snapshot(meta), status: 'available', lastSeenAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: [gewritDocuments.source, gewritDocuments.externalId],
          set: { ...snapshot(meta), status: 'available', lastSeenAt: now, updatedAt: now },
        })
        .returning();
      const [l] = await tx.insert(gewritLinks)
        .values({ documentId: d!.id, assetId: input.assetId ?? null, placeId: input.placeId ?? null, role: input.role, note: input.note ?? null })
        .returning();
      return linkView(provider, l!, d!);
    });
  } catch (e) {
    const code = pgErrorCode(e);
    if (code === '23505') throw new GewritError('ALREADY_LINKED', 'That document is already linked here in that role');
    // The element was deleted between the existence check and the insert.
    if (code === '23503') throw new GewritError('ELEMENT_NOT_FOUND', 'That asset or place does not exist');
    throw e;
  }
}

export async function updateLink(
  provider: DocumentProvider, id: string, input: { role?: LinkRole; note?: string | null },
): Promise<LinkView | null> {
  try {
    const [l] = await db.update(gewritLinks)
      .set({
        ...(input.role !== undefined ? { role: input.role } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
        updatedAt: new Date(),
      })
      .where(eq(gewritLinks.id, id))
      .returning();
    if (!l) return null;
    const [d] = await db.select().from(gewritDocuments).where(eq(gewritDocuments.id, l.documentId));
    return linkView(provider, l, d!);
  } catch (e) {
    if (pgErrorCode(e) === '23505') throw new GewritError('ALREADY_LINKED', 'That document is already linked here in that role');
    throw e;
  }
}

/**
 * Deletes a link, and the document row with its last link.
 *
 * Lock order is document row FIRST, then the link — the order createLink takes
 * them in (upsert the document, then insert the link). Deleting the link first
 * would deadlock against a concurrent relink: createLink holding the document
 * and waiting on the link's unique-index entry, this waiting on the document.
 * The final existence check is a NEW statement after the lock, so it sees any
 * link a concurrent createLink committed — a NOT EXISTS evaluated before the
 * lock could miss that link and cascade it away.
 */
export async function deleteLink(id: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [l] = await tx.select({ documentId: gewritLinks.documentId }).from(gewritLinks).where(eq(gewritLinks.id, id));
    if (!l) return false;
    await tx.execute(sql`SELECT id FROM gewrit_documents WHERE id = ${l.documentId} FOR UPDATE`);
    const deleted = await tx.delete(gewritLinks).where(eq(gewritLinks.id, id)).returning({ id: gewritLinks.id });
    if (deleted.length === 0) return false;
    await tx.execute(sql`
      DELETE FROM gewrit_documents d
       WHERE d.id = ${l.documentId}
         AND NOT EXISTS (SELECT 1 FROM gewrit_links x WHERE x.document_id = ${l.documentId})`);
    return true;
  });
}

/** The preview gate: a document row WITH at least one link, or null. */
export async function previewTarget(documentId: string): Promise<{ id: string; source: string; externalId: string } | null> {
  const rows = await db.select({ id: gewritDocuments.id, source: gewritDocuments.source, externalId: gewritDocuments.externalId })
    .from(gewritDocuments)
    .where(and(
      eq(gewritDocuments.id, documentId),
      sql`EXISTS (SELECT 1 FROM gewrit_links l WHERE l.document_id = ${gewritDocuments.id})`,
    ));
  return rows[0] ?? null;
}

export async function markMissing(documentId: string): Promise<void> {
  await db.update(gewritDocuments).set({ status: 'missing', updatedAt: new Date() }).where(eq(gewritDocuments.id, documentId));
}

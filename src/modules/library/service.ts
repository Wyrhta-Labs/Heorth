import { and, eq, sql, inArray, desc } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  libraryConnections, libraryItems,
  type LibraryConnectionRow, type LibraryItemRow, type Provider, type MediaType, type ItemStatus, type StandardList,
} from './schema.js';
import type { Connector, LibraryItem, RawConnection } from './connectors/types.js';
import { LibraryThingConnector, LibraryThingEndpointError, parseLibraryThingExport } from './connectors/librarything.js';
import { TraktConnector } from './connectors/trakt.js';

export type PublicConnection = Omit<LibraryConnectionRow, 'credentials'>;

function toPublic(row: LibraryConnectionRow): PublicConnection {
  const { credentials: _omit, ...pub } = row;
  return pub;
}

export function getConnectorFor(provider: Provider): Connector {
  switch (provider) {
    case 'librarything': return new LibraryThingConnector();
    case 'trakt': return new TraktConnector();
  }
}

export async function listConnections(): Promise<PublicConnection[]> {
  const rows = await db.select().from(libraryConnections).orderBy(libraryConnections.label);
  return rows.map(toPublic);
}

async function getRaw(id: string): Promise<LibraryConnectionRow | null> {
  const [row] = await db.select().from(libraryConnections).where(eq(libraryConnections.id, id)).limit(1);
  return row ?? null;
}

export async function createLibraryThingConnection(
  memberId: string, input: { userid: string; key: string },
): Promise<PublicConnection> {
  const conn = new LibraryThingConnector();
  const { externalRef, label, credentials } = await conn.connect(input);
  const [row] = await db.insert(libraryConnections).values({
    memberId, provider: 'librarything', label, externalRef, credentials,
  }).returning();
  return toPublic(row!);
}

const trakt = new TraktConnector();

export async function startTraktDevice() {
  return trakt.requestDeviceCode();
}

export async function pollTraktDevice(
  memberId: string, deviceCode: string,
): Promise<{ status: 'pending' } | { status: 'authorized'; connection: PublicConnection }> {
  const result = await trakt.pollForToken(deviceCode);
  if (result.status === 'pending') return { status: 'pending' };
  const { externalRef, label, credentials } = result.connection;
  const [row] = await db.insert(libraryConnections).values({
    memberId, provider: 'trakt', label, externalRef, credentials,
  }).onConflictDoUpdate({
    target: [libraryConnections.provider, libraryConnections.externalRef, libraryConnections.memberId],
    set: { credentials, status: 'active', updatedAt: new Date(), lastSyncError: null },
  }).returning();
  return { status: 'authorized', connection: toPublic(row!) };
}

/** LibraryThing export-file fallback: replace this connection's items from the file. */
export async function importFile(
  memberId: string, connectionId: string, json: unknown,
): Promise<{ imported: number }> {
  const conn = await getRaw(connectionId);
  if (!conn || conn.provider !== 'librarything') throw new Error('NOT_FOUND');
  let items;
  try {
    items = parseLibraryThingExport(json);
  } catch (e) {
    throw new Error(`IMPORT_PARSE_FAILED: ${(e as Error).message}`);
  }
  await db.transaction(async (tx) => {
    await tx.delete(libraryItems).where(eq(libraryItems.connectionId, connectionId));
    if (items.length) {
      await tx.insert(libraryItems).values(items.map((i) => ({
        connectionId, mediaType: i.mediaType, externalId: i.externalId, title: i.title,
        sortTitle: i.sortTitle, creators: i.creators, year: i.year, coverUrl: i.coverUrl,
        status: i.status, lists: i.lists, rating: i.rating != null ? String(i.rating) : null,
        tags: i.tags, sourceUrl: i.sourceUrl, raw: i.raw as object,
      })));
    }
    await tx.update(libraryConnections).set({
      status: 'active', lastSyncedAt: new Date(), lastSyncError: null, itemCount: items.length, updatedAt: new Date(),
    }).where(eq(libraryConnections.id, connectionId));
  });
  return { imported: items.length };
}

export async function deleteConnection(
  id: string, actor: { userId: string; role: string },
): Promise<{ id: string } | null> {
  const conn = await getRaw(id);
  if (!conn) return null;
  if (actor.role !== 'admin' && conn.memberId !== actor.userId) throw new Error('FORBIDDEN');
  await db.delete(libraryConnections).where(eq(libraryConnections.id, id));
  return { id };
}

export type ItemView = LibraryItemRow & { memberId: string; provider: string };

function toInsert(connectionId: string, i: LibraryItem) {
  return {
    connectionId, mediaType: i.mediaType, externalId: i.externalId, title: i.title,
    sortTitle: i.sortTitle, creators: i.creators, year: i.year, coverUrl: i.coverUrl,
    status: i.status, lists: i.lists, rating: i.rating != null ? String(i.rating) : null,
    tags: i.tags, sourceUrl: i.sourceUrl, raw: i.raw as object,
  };
}

export async function syncConnection(id: string): Promise<PublicConnection> {
  const conn = await getRaw(id);
  if (!conn) throw new Error('NOT_FOUND');
  const connector = getConnectorFor(conn.provider as Provider);
  const raw: RawConnection = { id: conn.id, provider: conn.provider as Provider, externalRef: conn.externalRef, credentials: conn.credentials };

  let items: LibraryItem[];
  let rotated: string | null | undefined;
  try {
    ({ items, credentials: rotated } = await connector.fetchItems(raw));
  } catch (e) {
    const needsReauth = e instanceof LibraryThingEndpointError || (e as { needsReauth?: boolean }).needsReauth;
    await db.update(libraryConnections).set({
      status: needsReauth ? 'needs_reauth' : 'error',
      lastSyncError: (e as Error).message, updatedAt: new Date(),
    }).where(eq(libraryConnections.id, id));
    throw e;
  }

  await db.transaction(async (tx) => {
    const seen: string[] = [];
    for (const i of items) {
      seen.push(`${i.mediaType}:${i.externalId}`);
      await tx.insert(libraryItems).values(toInsert(id, i)).onConflictDoUpdate({
        target: [libraryItems.connectionId, libraryItems.mediaType, libraryItems.externalId],
        set: {
          title: i.title, sortTitle: i.sortTitle, creators: i.creators, year: i.year,
          coverUrl: i.coverUrl, status: i.status, lists: i.lists,
          rating: i.rating != null ? String(i.rating) : null, tags: i.tags,
          sourceUrl: i.sourceUrl, raw: i.raw as object, syncedAt: new Date(), updatedAt: new Date(),
        },
      });
    }
    // Delete vanished rows for this connection.
    const existing = await tx.select().from(libraryItems).where(eq(libraryItems.connectionId, id));
    const toDelete = existing.filter((r) => !seen.includes(`${r.mediaType}:${r.externalId}`)).map((r) => r.id);
    if (toDelete.length) await tx.delete(libraryItems).where(inArray(libraryItems.id, toDelete));

    await tx.update(libraryConnections).set({
      status: 'active', lastSyncedAt: new Date(), lastSyncError: null, itemCount: items.length, updatedAt: new Date(),
      ...(rotated ? { credentials: rotated } : {}),
    }).where(eq(libraryConnections.id, id));
  });
  return toPublic((await getRaw(id))!);
}

const ITEM_COLUMNS = {
  id: libraryItems.id, createdAt: libraryItems.createdAt, updatedAt: libraryItems.updatedAt,
  syncedAt: libraryItems.syncedAt, connectionId: libraryItems.connectionId, mediaType: libraryItems.mediaType,
  externalId: libraryItems.externalId, title: libraryItems.title, sortTitle: libraryItems.sortTitle,
  creators: libraryItems.creators, year: libraryItems.year, coverUrl: libraryItems.coverUrl,
  status: libraryItems.status, lists: libraryItems.lists, rating: libraryItems.rating,
  tags: libraryItems.tags, sourceUrl: libraryItems.sourceUrl, raw: libraryItems.raw,
  memberId: libraryConnections.memberId, provider: libraryConnections.provider,
} as const;

export async function listItems(q: {
  mediaType?: MediaType; memberId?: string; provider?: string; status?: ItemStatus; list?: StandardList; tag?: string;
  limit?: number; offset?: number;
}): Promise<{ rows: ItemView[]; total: number; limit: number; offset: number }> {
  const limit = Math.min(200, Math.max(1, q.limit ?? 50));
  const offset = Math.max(0, q.offset ?? 0);
  const conds = [
    q.mediaType ? eq(libraryItems.mediaType, q.mediaType) : undefined,
    q.memberId ? eq(libraryConnections.memberId, q.memberId) : undefined,
    q.provider ? eq(libraryConnections.provider, q.provider) : undefined,
    q.status ? eq(libraryItems.status, q.status) : undefined,
    q.list ? sql`${q.list} = ANY(${libraryItems.lists})` : undefined,
    q.tag ? sql`${q.tag} = ANY(${libraryItems.tags})` : undefined,
  ].filter(Boolean);
  const where = conds.length ? and(...(conds as any[])) : undefined;

  const rows = await db.select(ITEM_COLUMNS).from(libraryItems)
    .innerJoin(libraryConnections, eq(libraryItems.connectionId, libraryConnections.id))
    .where(where).orderBy(libraryItems.sortTitle).limit(limit).offset(offset);
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(libraryItems)
    .innerJoin(libraryConnections, eq(libraryItems.connectionId, libraryConnections.id)).where(where);
  return { rows: rows as ItemView[], total: count, limit, offset };
}

export async function searchItems(query: string, limit = 50): Promise<ItemView[]> {
  const rows = await db.select(ITEM_COLUMNS).from(libraryItems)
    .innerJoin(libraryConnections, eq(libraryItems.connectionId, libraryConnections.id))
    .where(sql`${libraryItems.title} ILIKE ${'%' + query + '%'} OR array_to_string(${libraryItems.creators}, ' ') ILIKE ${'%' + query + '%'}`)
    .orderBy(desc(libraryItems.updatedAt)).limit(limit);
  return rows as ItemView[];
}

export async function getItem(id: string): Promise<ItemView | null> {
  const [row] = await db.select(ITEM_COLUMNS).from(libraryItems)
    .innerJoin(libraryConnections, eq(libraryItems.connectionId, libraryConnections.id))
    .where(eq(libraryItems.id, id)).limit(1);
  return (row as ItemView) ?? null;
}

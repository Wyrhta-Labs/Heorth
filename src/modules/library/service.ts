import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { libraryConnections, libraryItems, type LibraryConnectionRow, type Provider } from './schema.js';
import type { Connector } from './connectors/types.js';
import { LibraryThingConnector, parseLibraryThingExport } from './connectors/librarything.js';
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

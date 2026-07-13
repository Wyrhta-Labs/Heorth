import { describe, it, expect } from 'vitest';
import { seedTestHousehold } from './helpers.js';
import { db } from '../src/db/index.js';
import { libraryConnections, libraryItems } from '../src/modules/library/schema.js';
import { eq } from 'drizzle-orm';

describe('library schema', () => {
  it('inserts a connection and an item with provenance', async () => {
    const { admin } = await seedTestHousehold();
    const [conn] = await db.insert(libraryConnections).values({
      memberId: admin.user.id, provider: 'trakt', label: "Admin's Trakt", externalRef: 'admin-slug',
    }).returning();
    expect(conn!.status).toBe('active');
    expect(conn!.itemCount).toBe(0);

    const [item] = await db.insert(libraryItems).values({
      connectionId: conn!.id, mediaType: 'movie', externalId: 'tt123', title: 'Dune', sortTitle: 'dune', raw: {},
    }).returning();
    expect(item!.lists).toEqual([]);
    expect(item!.creators).toEqual([]);

    const found = await db.select().from(libraryItems).where(eq(libraryItems.connectionId, conn!.id));
    expect(found).toHaveLength(1);
  });

  it('enforces unique (connectionId, mediaType, externalId)', async () => {
    const { admin } = await seedTestHousehold();
    const [conn] = await db.insert(libraryConnections).values({
      memberId: admin.user.id, provider: 'librarything', label: 'LT', externalRef: 'u1',
    }).returning();
    const row = { connectionId: conn!.id, mediaType: 'book' as const, externalId: 'b1', title: 'A', sortTitle: 'a', raw: {} };
    await db.insert(libraryItems).values(row);
    await expect(db.insert(libraryItems).values(row)).rejects.toThrow();
  });
});

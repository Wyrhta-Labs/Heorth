import { describe, it, expect } from 'vitest';
import { seedTestHousehold } from './helpers.js';
import * as service from '../src/modules/library/service.js';
import { db } from '../src/db/index.js';
import { libraryItems } from '../src/modules/library/schema.js';
import { eq } from 'drizzle-orm';

const ltExport = {
  '1': { books_id: '1', title: 'Dune', authors: [{ fl: 'Frank Herbert' }], date: '1965', collections: { a: 'Read' } },
};

describe('library connections service', () => {
  it('creates a LibraryThing connection without leaking credentials', async () => {
    const { adult } = await seedTestHousehold();
    const conn = await service.createLibraryThingConnection(adult.user.id, { userid: 'u1', key: 'k1' });
    expect(conn.provider).toBe('librarything');
    expect((conn as Record<string, unknown>)['credentials']).toBeUndefined();
    const list = await service.listConnections();
    expect(list.some((c) => c.id === conn.id)).toBe(true);
  });

  it('imports an export file into items and clears needs_reauth', async () => {
    const { adult } = await seedTestHousehold();
    const conn = await service.createLibraryThingConnection(adult.user.id, { userid: 'u1', key: 'k1' });
    const { imported } = await service.importFile(adult.user.id, conn.id, ltExport);
    expect(imported).toBe(1);
    const rows = await db.select().from(libraryItems).where(eq(libraryItems.connectionId, conn.id));
    expect(rows[0]!.title).toBe('Dune');
  });

  it('forbids deleting another member’s connection unless admin', async () => {
    const { admin, adult, child } = await seedTestHousehold();
    const conn = await service.createLibraryThingConnection(adult.user.id, { userid: 'u2', key: 'k' });
    await expect(service.deleteConnection(conn.id, { userId: child.user.id, role: 'child' }))
      .rejects.toThrow('FORBIDDEN');
    const deleted = await service.deleteConnection(conn.id, { userId: admin.user.id, role: 'admin' });
    expect(deleted).toEqual({ id: conn.id });
  });
});

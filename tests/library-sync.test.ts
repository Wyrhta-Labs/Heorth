import { describe, it, expect, vi } from 'vitest';
import { seedTestHousehold } from './helpers.js';
import * as service from '../src/modules/library/service.js';
import * as ltMod from '../src/modules/library/connectors/librarything.js';

function fakeItems(ids: string[]) {
  return ids.map((id) => ({
    mediaType: 'book' as const, externalId: id, title: `T${id}`, sortTitle: `t${id}`,
    creators: [], year: null, coverUrl: null, status: 'unread' as const, lists: [],
    rating: null, tags: [], sourceUrl: null, raw: {},
  }));
}

describe('library sync', () => {
  it('upserts new, updates changed, deletes vanished', async () => {
    const { adult } = await seedTestHousehold();
    const conn = await service.createLibraryThingConnection(adult.user.id, { userid: 'u', key: 'k' });

    const spy = vi.spyOn(ltMod.LibraryThingConnector.prototype, 'fetchItems');
    spy.mockResolvedValueOnce(fakeItems(['1', '2', '3']));
    await service.syncConnection(conn.id);
    let page = await service.listItems({});
    expect(page.total).toBe(3);

    // Second sync: 2 gone, 4 new.
    spy.mockResolvedValueOnce(fakeItems(['1', '3', '4']));
    const updated = await service.syncConnection(conn.id);
    expect(updated.itemCount).toBe(3);
    page = await service.listItems({});
    expect(page.rows.map((r) => r.externalId).sort()).toEqual(['1', '3', '4']);
    spy.mockRestore();
  });

  it('flips to needs_reauth when the LibraryThing endpoint fails', async () => {
    const { adult } = await seedTestHousehold();
    const conn = await service.createLibraryThingConnection(adult.user.id, { userid: 'u', key: 'k' });
    const spy = vi.spyOn(ltMod.LibraryThingConnector.prototype, 'fetchItems')
      .mockRejectedValueOnce(new ltMod.LibraryThingEndpointError('403'));
    await expect(service.syncConnection(conn.id)).rejects.toThrow();
    const list = await service.listConnections();
    expect(list.find((c) => c.id === conn.id)!.status).toBe('needs_reauth');
    spy.mockRestore();
  });

  it('searches by title', async () => {
    const { adult } = await seedTestHousehold();
    const conn = await service.createLibraryThingConnection(adult.user.id, { userid: 'u', key: 'k' });
    vi.spyOn(ltMod.LibraryThingConnector.prototype, 'fetchItems').mockResolvedValueOnce(fakeItems(['9']));
    await service.syncConnection(conn.id);
    const hits = await service.searchItems('T9');
    expect(hits).toHaveLength(1);
  });
});

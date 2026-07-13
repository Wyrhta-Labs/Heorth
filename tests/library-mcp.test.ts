import { describe, it, expect, vi } from 'vitest';
import { seedTestHousehold, invokeTool } from './helpers.js';
import { libraryTools } from '../src/modules/library/mcp.js';
import * as service from '../src/modules/library/service.js';
import * as ltMod from '../src/modules/library/connectors/librarything.js';

describe('library MCP tools', () => {
  it('lists items and connections', async () => {
    const { adult } = await seedTestHousehold();
    const conn = await service.createLibraryThingConnection(adult.user.id, { userid: 'u', key: 'k' });
    vi.spyOn(ltMod.LibraryThingConnector.prototype, 'fetchItems').mockResolvedValueOnce({ items: [{
      mediaType: 'book', externalId: '1', title: 'Dune', sortTitle: 'dune', creators: ['Frank Herbert'],
      year: 1965, coverUrl: null, status: 'read', lists: ['favorites'], rating: 5, tags: [], sourceUrl: null, raw: {},
    }] });
    await service.syncConnection(conn.id);

    const list = await invokeTool(libraryTools, 'library.list_items',
      { userId: adult.user.id, role: 'adult' }, { list: 'favorites' }) as { items: Array<{ title: string }> };
    expect(list.items[0]!.title).toBe('Dune');

    const conns = await invokeTool(libraryTools, 'library.list_connections',
      { userId: adult.user.id, role: 'adult' }, {}) as { connections: unknown[] };
    expect(conns.connections).toHaveLength(1);
  });
});

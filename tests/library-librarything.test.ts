import { describe, it, expect, vi } from 'vitest';
import { LibraryThingConnector, LibraryThingEndpointError, parseLibraryThingExport } from '../src/modules/library/connectors/librarything.js';

const sampleExport = {
  '1001': {
    books_id: '1001', title: 'The Left Hand of Darkness',
    authors: [{ fl: 'Ursula K. Le Guin', lf: 'Le Guin, Ursula K.' }],
    date: '1969', rating: 5, format: 'Paperback',
    collections: { '1': 'Your library', '2': 'Read' }, tags: ['sci-fi'],
    url: 'https://www.librarything.com/work/1001',
  },
  '1002': {
    books_id: '1002', title: 'A Memory Called Empire',
    authors: [{ fl: 'Arkady Martine' }], date: '2019',
    format: 'Ebook', collections: { '3': 'To read' }, tags: [],
  },
};

describe('parseLibraryThingExport', () => {
  it('normalizes books, ebooks, status, and lists', () => {
    const items = parseLibraryThingExport(sampleExport);
    const left = items.find((i) => i.externalId === '1001')!;
    expect(left.mediaType).toBe('book');
    expect(left.creators).toEqual(['Ursula K. Le Guin']);
    expect(left.year).toBe(1969);
    expect(left.status).toBe('read');
    expect(left.rating).toBe(5);
    expect(left.sortTitle).toBe('left hand of darkness');

    const empire = items.find((i) => i.externalId === '1002')!;
    expect(empire.mediaType).toBe('ebook');
    expect(empire.status).toBe('unread');
    expect(empire.lists).toEqual(['later']);
  });
});

describe('LibraryThingConnector.fetchItems', () => {
  const conn = { id: 'c1', provider: 'librarything' as const, externalRef: 'u1' };

  it('parses a successful endpoint response', async () => {
    const fakeFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(sampleExport), { status: 200 }),
    );
    const c = new LibraryThingConnector({ fetch: fakeFetch as unknown as typeof fetch });
    // credentials would be encrypted in real use; connector decrypts internally.
    const enc = await c.connect({ userid: 'u1', key: 'k1' });
    const items = await c.fetchItems({ ...conn, credentials: enc.credentials });
    expect(items).toHaveLength(2);
  });

  it('throws LibraryThingEndpointError on non-200', async () => {
    const fakeFetch = vi.fn().mockResolvedValue(new Response('nope', { status: 403 }));
    const c = new LibraryThingConnector({ fetch: fakeFetch as unknown as typeof fetch });
    const enc = await c.connect({ userid: 'u1', key: 'k1' });
    await expect(c.fetchItems({ ...conn, credentials: enc.credentials }))
      .rejects.toBeInstanceOf(LibraryThingEndpointError);
  });
});

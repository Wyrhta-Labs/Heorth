import { z } from 'zod';
import type { Connector, LibraryItem, RawConnection } from './types.js';
import { makeSortTitle, mergeLists } from './normalize.js';
import type { MediaType, ItemStatus, StandardList } from '../schema.js';
import { encryptSecret, decryptSecret } from '../crypto.js';

export class LibraryThingEndpointError extends Error {
  constructor(message: string) { super(message); this.name = 'LibraryThingEndpointError'; }
}

const connectInput = z.object({ userid: z.string().min(1), key: z.string().min(1) });

/** Map a LibraryThing collection name to our normalized status / lists. */
function mapCollections(names: string[]): { status: ItemStatus | null; lists: StandardList[] } {
  const lower = names.map((n) => n.toLowerCase());
  let status: ItemStatus | null = null;
  const lists: StandardList[] = [];
  if (lower.some((n) => n === 'read')) status = 'read';
  else if (lower.some((n) => n.includes('currently reading'))) status = 'reading';
  if (lower.some((n) => n.includes('to read') || n.includes('wishlist'))) { lists.push('later'); if (!status) status = 'unread'; }
  if (lower.some((n) => n.includes('favorite'))) lists.push('favorites');
  if (!status) status = 'unread';
  return { status, lists };
}

function collectionNames(collections: unknown): string[] {
  if (Array.isArray(collections)) return collections.map(String);
  if (collections && typeof collections === 'object') return Object.values(collections as Record<string, string>);
  return [];
}

function isEbook(format: unknown): boolean {
  return typeof format === 'string' && /e-?book|kindle|epub|digital/i.test(format);
}

export function parseLibraryThingExport(json: unknown): LibraryItem[] {
  if (!json || typeof json !== 'object') throw new LibraryThingEndpointError('Unexpected LibraryThing payload');
  const books = Object.values(json as Record<string, any>);
  if (books.length === 0) throw new LibraryThingEndpointError('Empty LibraryThing payload');

  return books.map((b: any): LibraryItem => {
    const title: string = b.title ?? 'Untitled';
    const creators: string[] = Array.isArray(b.authors)
      ? b.authors.map((a: any) => a.fl ?? a.lf ?? String(a)).filter(Boolean)
      : [];
    const names = collectionNames(b.collections);
    const { status, lists } = mapCollections(names);
    const yearNum = b.date ? parseInt(String(b.date).match(/\d{4}/)?.[0] ?? '', 10) : NaN;
    const mediaType: MediaType = isEbook(b.format) ? 'ebook' : 'book';
    return {
      mediaType,
      externalId: String(b.books_id ?? b.id ?? title),
      title,
      sortTitle: makeSortTitle(title),
      creators,
      year: Number.isFinite(yearNum) ? yearNum : null,
      coverUrl: null,
      status,
      lists: mergeLists(lists),
      rating: typeof b.rating === 'number' && b.rating > 0 ? b.rating : null,
      tags: Array.isArray(b.tags) ? b.tags.map(String) : [],
      sourceUrl: typeof b.url === 'string' ? b.url : null,
      raw: b,
    };
  });
}

export class LibraryThingConnector implements Connector {
  readonly provider = 'librarything' as const;
  private readonly fetchFn: typeof fetch;

  constructor(deps: { fetch?: typeof fetch } = {}) {
    this.fetchFn = deps.fetch ?? fetch;
  }

  async connect(input: unknown): Promise<{ externalRef: string; label: string; credentials: string | null }> {
    const { userid, key } = connectInput.parse(input);
    return {
      externalRef: userid,
      label: `LibraryThing (${userid})`,
      credentials: encryptSecret(JSON.stringify({ userid, key })),
    };
  }

  async fetchItems(conn: RawConnection): Promise<LibraryItem[]> {
    if (!conn.credentials) throw new LibraryThingEndpointError('No credentials; use file import');
    const { userid, key } = JSON.parse(decryptSecret(conn.credentials)) as { userid: string; key: string };
    const url = `https://www.librarything.com/api_getdata.php?userid=${encodeURIComponent(userid)}` +
      `&key=${encodeURIComponent(key)}&responseType=json&showCollections=1&showTags=1`;
    let res: Response;
    try {
      res = await this.fetchFn(url);
    } catch (e) {
      throw new LibraryThingEndpointError(`LibraryThing endpoint unreachable: ${(e as Error).message}`);
    }
    if (!res.ok) throw new LibraryThingEndpointError(`LibraryThing endpoint returned ${res.status}`);
    let json: unknown;
    try { json = await res.json(); } catch { throw new LibraryThingEndpointError('LibraryThing returned non-JSON'); }
    return parseLibraryThingExport(json);
  }
}

import { describe, it, expect, vi } from 'vitest';
import { TraktConnector } from '../src/modules/library/connectors/trakt.js';
import { encryptSecret } from '../src/modules/library/crypto.js';

// Build a fake fetch that routes by URL substring.
function router(map: Record<string, unknown>, status = 200) {
  return vi.fn(async (url: string) => {
    const key = Object.keys(map).find((k) => String(url).includes(k));
    if (!key) return new Response('[]', { status: 200 });
    return new Response(JSON.stringify(map[key]), { status });
  });
}

const movie = { movie: { title: 'Dune', year: 2021, ids: { trakt: 1, imdb: 'tt1160419', slug: 'dune-2021' } } };
const show = { show: { title: 'Severance', year: 2022, ids: { trakt: 2, slug: 'severance' } } };

describe('TraktConnector.fetchItems', () => {
  const conn = {
    id: 'c1', provider: 'trakt' as const, externalRef: 'me',
    credentials: encryptSecret(JSON.stringify({ access_token: 'tok', refresh_token: 'r' })),
  };

  it('merges collection + watched + watchlist + favorites + ratings', async () => {
    const fetchFn = router({
      '/sync/collection/movies': [movie],
      '/sync/watched/movies': [{ ...movie, plays: 3 }],
      '/sync/watchlist/shows': [show],
      '/users/me/favorites/movies': [movie],
      '/sync/ratings/movies': [{ ...movie, rating: 9 }],
    });
    const c = new TraktConnector({ fetch: fetchFn as unknown as typeof fetch });
    const { items } = await c.fetchItems(conn);

    const dune = items.find((i) => i.externalId === '1')!;
    expect(dune.mediaType).toBe('movie');
    expect(dune.status).toBe('watched');
    expect(dune.lists).toEqual(['favorites']);
    expect(dune.rating).toBe(9);

    const sev = items.find((i) => i.externalId === '2')!;
    expect(sev.mediaType).toBe('series');
    expect(sev.lists).toEqual(['later']);
    expect(sev.status).toBe('unread');
  });

  it('keeps a movie and a show with the same numeric trakt id as two distinct items', async () => {
    const sharedId = 42;
    const sharedMovie = { movie: { title: 'Same Id Movie', year: 2020, ids: { trakt: sharedId, slug: 'same-id-movie' } } };
    const sharedShow = { show: { title: 'Same Id Show', year: 2021, ids: { trakt: sharedId, slug: 'same-id-show' } } };
    const fetchFn = router({
      '/sync/collection/movies': [sharedMovie],
      '/sync/collection/shows': [sharedShow],
    });
    const c = new TraktConnector({ fetch: fetchFn as unknown as typeof fetch });
    const { items } = await c.fetchItems(conn);

    const matches = items.filter((i) => i.externalId === String(sharedId));
    expect(matches).toHaveLength(2);
    expect(matches.find((i) => i.mediaType === 'movie')).toBeTruthy();
    expect(matches.find((i) => i.mediaType === 'series')).toBeTruthy();
  });
});

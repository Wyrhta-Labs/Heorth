import type { Connector, LibraryItem, RawConnection } from './types.js';
import { makeSortTitle, mergeLists } from './normalize.js';
import type { MediaType, ItemStatus, StandardList } from '../schema.js';
import { encryptSecret, decryptSecret } from '../crypto.js';
import { config } from '../../../config/env.js';

const API = 'https://api.trakt.tv';

interface Tokens { access_token: string; refresh_token: string }

function requireClient(): { id: string; secret: string } {
  if (!config.traktClientId || !config.traktClientSecret) {
    throw new Error('Trakt is not configured (set TRAKT_CLIENT_ID / TRAKT_CLIENT_SECRET)');
  }
  return { id: config.traktClientId, secret: config.traktClientSecret };
}

export class TraktConnector implements Connector {
  readonly provider = 'trakt' as const;
  private readonly fetchFn: typeof fetch;

  constructor(deps: { fetch?: typeof fetch } = {}) {
    this.fetchFn = deps.fetch ?? fetch;
  }

  async connect(): Promise<{ externalRef: string; label: string; credentials: string | null }> {
    throw new Error('Trakt uses the device flow: requestDeviceCode + pollForToken');
  }

  async requestDeviceCode() {
    const { id } = requireClient();
    const res = await this.fetchFn(`${API}/oauth/device/code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: id }),
    });
    if (!res.ok) throw new Error(`Trakt device/code failed: ${res.status}`);
    return res.json() as Promise<{ device_code: string; user_code: string; verification_url: string; interval: number; expires_in: number }>;
  }

  /** One poll tick. Returns pending, or an authorized connection descriptor. */
  async pollForToken(deviceCode: string): Promise<
    | { status: 'pending' }
    | { status: 'authorized'; connection: { externalRef: string; label: string; credentials: string } }
  > {
    const { id, secret } = requireClient();
    const res = await this.fetchFn(`${API}/oauth/device/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: deviceCode, client_id: id, client_secret: secret }),
    });
    if (res.status === 400) return { status: 'pending' };
    if (!res.ok) throw new Error(`Trakt device/token failed: ${res.status}`);
    const tokens = await res.json() as Tokens;
    const username = await this.getUsername(tokens.access_token);
    return {
      status: 'authorized',
      connection: {
        externalRef: username,
        label: `Trakt (${username})`,
        credentials: encryptSecret(JSON.stringify(tokens)),
      },
    };
  }

  private headers(token: string): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'trakt-api-version': '2',
      'trakt-api-key': config.traktClientId ?? '',
      Authorization: `Bearer ${token}`,
    };
  }

  private async getUsername(token: string): Promise<string> {
    const res = await this.fetchFn(`${API}/users/settings`, { headers: this.headers(token) });
    if (!res.ok) return 'me';
    const body = await res.json() as { user?: { username?: string; ids?: { slug?: string } } };
    return body.user?.ids?.slug ?? body.user?.username ?? 'me';
  }

  private async refresh(tokens: Tokens): Promise<Tokens> {
    const { id, secret } = requireClient();
    const res = await this.fetchFn(`${API}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        refresh_token: tokens.refresh_token, client_id: id, client_secret: secret,
        grant_type: 'refresh_token', redirect_uri: 'urn:ietf:wg:oauth:2.0:oob',
      }),
    });
    if (!res.ok) { const e = new Error('Trakt token refresh failed'); (e as any).needsReauth = true; throw e; }
    return res.json() as Promise<Tokens>;
  }

  private async getJson(path: string, token: string): Promise<any[]> {
    const res = await this.fetchFn(`${API}${path}?extended=full`, { headers: this.headers(token) });
    if (!res.ok) return [];
    return res.json() as Promise<any[]>;
  }

  async fetchItems(conn: RawConnection): Promise<LibraryItem[]> {
    if (!conn.credentials) { const e = new Error('No Trakt credentials'); (e as any).needsReauth = true; throw e; }
    let tokens = JSON.parse(decryptSecret(conn.credentials)) as Tokens;

    // Probe once; refresh on 401 then continue.
    const probe = await this.fetchFn(`${API}/sync/last_activities`, { headers: this.headers(tokens.access_token) });
    if (probe.status === 401) tokens = await this.refresh(tokens);
    const token = tokens.access_token;

    const byId = new Map<string, LibraryItem>();
    const upsert = (raw: any, media: MediaType, patch: Partial<LibraryItem>) => {
      const node = raw.movie ?? raw.show ?? raw;
      const id = String(node.ids?.trakt ?? node.ids?.imdb ?? node.title);
      const existing = byId.get(id);
      const title: string = node.title ?? 'Untitled';
      const base: LibraryItem = existing ?? {
        mediaType: media, externalId: id, title, sortTitle: makeSortTitle(title),
        creators: [], year: node.year ?? null, coverUrl: null, status: null, lists: [],
        rating: null, tags: [],
        sourceUrl: node.ids?.slug ? `https://trakt.tv/${media === 'series' ? 'shows' : 'movies'}/${node.ids.slug}` : null,
        raw: node,
      };
      byId.set(id, {
        ...base,
        ...patch,
        lists: mergeLists(base.lists, patch.lists ?? []),
        status: patch.status ?? base.status,
        rating: patch.rating ?? base.rating,
      });
    };

    const pull = async (path: string, media: MediaType, patch: (row: any) => Partial<LibraryItem>) => {
      for (const row of await this.getJson(path, token)) upsert(row, media, patch(row));
    };

    await pull('/sync/collection/movies', 'movie', () => ({ status: 'unread' }));
    await pull('/sync/collection/shows', 'series', () => ({ status: 'unread' }));
    await pull('/sync/watched/movies', 'movie', () => ({ status: 'watched' }));
    await pull('/sync/watched/shows', 'series', () => ({ status: 'watched' }));
    await pull('/sync/watchlist/movies', 'movie', () => ({ lists: ['later' as StandardList], status: 'unread' }));
    await pull('/sync/watchlist/shows', 'series', () => ({ lists: ['later' as StandardList], status: 'unread' }));
    await pull('/users/me/favorites/movies', 'movie', () => ({ lists: ['favorites' as StandardList] }));
    await pull('/users/me/favorites/shows', 'series', () => ({ lists: ['favorites' as StandardList] }));
    await pull('/sync/ratings/movies', 'movie', (r) => ({ rating: r.rating ?? null }));
    await pull('/sync/ratings/shows', 'series', (r) => ({ rating: r.rating ?? null }));

    return [...byId.values()].map((i) => ({ ...i, status: i.status ?? (i.lists.length ? 'unread' as ItemStatus : i.status) }));
  }
}

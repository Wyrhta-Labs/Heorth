# Heorth Library Module — Design

**Date:** 2026-07-13
**Status:** Approved design; ready for implementation planning
**Module:** `src/modules/library/`

## Summary

A new Heorth module that presents a household's books, ebooks, movies, and
series as one unified, browsable, searchable shelf. It is a **read-only mirror**:
Heorth pulls collections *in* from external accounts and never writes back. The
external services remain the source of truth; Heorth is a normalized read cache
plus a browse/search/detail layer.

**v1 sources:**
- **Trakt** (movies, series) — live OAuth device-code connection.
- **LibraryThing** (books, ebooks) — unofficial `api_getdata.php` endpoint, with
  a sanctioned **Export Books** file-import fallback baked into the same connector.

**Deferred (documented, not built in v1):** Lismio audiobooks (import-based, no
official API), scheduled/background sync, cross-source dedup, TMDB cover
enrichment, and any write-back to services.

## Key decisions

| Decision | Choice | Rationale |
|---|---|---|
| Data direction | Read-only mirror | External services stay source of truth; smallest correct scope. |
| Account model | Attributed to a member; multiple accounts per service | Matches a real family; items keep provenance (which member/account). |
| Cross-source dedup | None in v1 | Two members owning the same title = two entries. Keeps entries per-account. |
| Sync | Manual only ("Sync now") | No scheduler dependency in v1; scheduling deferred. |
| LibraryThing | `api_getdata.php` endpoint + Export-file fallback | User accepted endpoint risk; fallback keeps books working if endpoint is dead. |
| Surfaces | REST + Web UI + MCP | Consistent with other Heorth modules. |
| Structure | Approach A — unified connector abstraction + normalized shelf | One `Connector` interface; adding a source later = one class, no schema change. |

### Known risk: LibraryThing API availability

LibraryThing offers **no sanctioned live API for a member's own catalog** (member
book data was withdrawn due to Amazon data-licensing terms). The JSON Books/Works
APIs are browser-only metadata lookups and may not be fetched or stored server-side.
The `api_getdata.php?userid=…&responseType=json` endpoint is undocumented, may
violate ToS, and per a 2022 notice the APIs may be disabled entirely. The design
mitigates this by making the LibraryThing connector **dual-mode**: it attempts the
endpoint and falls back to a user-uploaded **Export Books** file (the sanctioned
path). Both modes feed one identical normalizer.

Sources: LibraryThing Web Services (`/services/webservices.php`), Developer Hub
(`/developer`), APIs wiki (`wiki.librarything.com/index.php/LibraryThing_APIs`).

## Architecture

### Module layout

```
src/modules/library/
  index.ts          # HeorthModule: registers routes + MCP tools
  schema.ts         # Drizzle tables (connections, items)
  service.ts        # connections, sync orchestration, queries (owns all DB writes)
  routes.ts         # Hono routes under /api/v1/library/*
  validators.ts     # Zod input schemas
  mcp.ts            # MCP tools
  crypto.ts         # AES-256-GCM encrypt/decrypt for stored credentials
  connectors/
    types.ts        # Connector interface + normalized LibraryItem type
    trakt.ts        # TraktConnector — OAuth live pull
    librarything.ts # LibraryThingConnector — endpoint pull + file-import fallback
    normalize.ts    # raw → LibraryItem mappers, status/list mapping tables
```

### Layering (the invariant that keeps it clean)

`routes → service → connectors + db`

- **Routes** never touch connectors or the DB directly.
- **Connectors** never touch the DB. A connector only `connect()`s and
  `fetchItems()` returning normalized `LibraryItem[]`.
- **Service** owns all persistence, provenance, encryption, and the idempotent
  upsert.

This makes browse/search/detail fully source-agnostic and makes Lismio (or
Goodreads/Plex/etc.) a drop-in: one new connector class, zero schema change.

### Web app

- `web/src/pages/library.tsx`
- `web/src/api/library.ts` (client wrappers, mirroring `meals.ts`/`calendar.ts`)
- `web/src/components/library/`
- Registered in the router and dashboard nav alongside Meals/Calendar/Feoh.

### Config (env)

Added to `buildEnvSchema()`:
- `TRAKT_CLIENT_ID` — optional. Trakt connector unavailable until set; Heorth still boots.
- `TRAKT_CLIENT_SECRET` — optional, as above.
- `LIBRARY_ENCRYPTION_KEY` — optional, 32-byte base64. If unset, a key is derived
  via HKDF from the existing `JWT_SECRET` (works out-of-the-box on existing
  deployments) and a startup warning recommends setting a dedicated key.

## Data model

Provenance chain: `library_items.connectionId → library_connections.memberId → users.id`.

### `library_connections` — one row per connected account

```
id            uuid pk (gen_random_uuid())
createdAt     timestamptz not null default now()
updatedAt     timestamptz not null default now()
memberId      uuid not null → users.id (on delete cascade)   -- whose account
provider      text not null    -- 'trakt' | 'librarything'
label         text not null    -- e.g. "Anna's Trakt"
externalRef   text not null    -- trakt username/slug, or LibraryThing userid
credentials   text             -- AES-GCM ciphertext (OAuth tokens / LT key); NULL for file-only
status        text not null default 'active'  -- 'active' | 'needs_reauth' | 'error'
lastSyncedAt  timestamptz
lastSyncError text
itemCount     integer not null default 0
              unique(provider, externalRef, memberId)
```

### `library_items` — normalized shelf entry (one per item per connection)

```
id            uuid pk (gen_random_uuid())
createdAt     timestamptz not null default now()
updatedAt     timestamptz not null default now()
syncedAt      timestamptz not null default now()
connectionId  uuid not null → library_connections.id (on delete cascade)
mediaType     text not null    -- 'book' | 'ebook' | 'movie' | 'series'
externalId    text not null    -- trakt/tmdb/imdb id, or LT book id
title         text not null
sortTitle     text not null    -- for ordering
creators      text[] not null default '{}'   -- authors / directors (best-effort)
year          integer
coverUrl      text             -- best-effort; may be null (TMDB enrichment deferred)
status        text             -- lifecycle: 'unread'|'reading'|'read'|'watching'|'watched'
lists         text[] not null default '{}'   -- orthogonal membership: 'later' | 'favorites'
rating        numeric          -- member's rating if the source has one
tags          text[] not null default '{}'
sourceUrl     text             -- deep link back to the source item
raw           jsonb not null   -- untouched source payload, for re-normalize/debug
              unique(connectionId, mediaType, externalId)
```

Indexes: `mediaType`, `connectionId`, GIN on `lists`, and a text-search index over
`title`/`creators`.

### Status vs. lists (important modeling choice)

`status` is the **single-valued lifecycle** of consuming an item. `lists` is
**orthogonal membership** in standard static lists — an item can be `read` *and* a
`favorite` simultaneously, so favourites cannot be a status. "Watch/read later" is
likewise a list you're on, not where you are in consuming the item.

Normalized `lists` vocabulary (controlled, extensible): `later`, `favorites`.

Source mapping (`normalize.ts`):

| Normalized | Trakt | LibraryThing |
|---|---|---|
| `lists: ['later']` | watchlist | "To read" / Wishlist collection |
| `lists: ['favorites']` | favorites list | "Favorites" collection |
| `status: watched` | watched history | — |
| `status: read` | — | "Read" collection |
| `status: reading` | — | "Currently reading" collection |
| `status: unread` | in collection, not watched | owned, not read |

An item flagged for-later but not yet consumed is `status: unread` +
`lists: ['later']` — no overloading.

## Connector framework, auth & sync

### Interface (`connectors/types.ts`)

```ts
interface Connector {
  provider: 'trakt' | 'librarything'
  // Turn user-supplied input into stored credentials + externalRef + label.
  connect(input): Promise<{ externalRef: string; label: string; credentials: string | null }>
  // Pull the account's whole collection, already normalized.
  fetchItems(conn): Promise<LibraryItem[]>
}
```

Connectors are pure fetch-and-normalize: unit-testable with a fake HTTP layer, no
DB access.

### Trakt connector — OAuth device-code flow

Device flow suits a self-hosted app with no public redirect URL:

1. UI "Connect Trakt" → backend `POST https://api.trakt.tv/oauth/device/code`
   (with `TRAKT_CLIENT_ID`) → `{ user_code, verification_url, device_code, interval }`.
2. UI shows: "Go to `verification_url` and enter **`user_code`**."
3. UI polls backend, which polls `POST /oauth/device/token` until authorized →
   `{ access_token, refresh_token }`, encrypted into `credentials`.
4. `fetchItems` pulls `/sync/collection/{movies,shows}`,
   `/sync/watched/{movies,shows}`, `/sync/watchlist`, `/sync/favorites`,
   `/sync/ratings` with headers `trakt-api-version: 2`, `trakt-api-key: <client_id>`,
   `Authorization: Bearer <token>`. Maps to `movie`/`series` items;
   watched→`status: watched`, watchlist→`lists:['later']`, favorites→`lists:['favorites']`,
   plus rating. On 401 it refreshes the token; if refresh fails → `status: needs_reauth`.

Covers: Trakt serves no images. v1 leaves `coverUrl` null. TMDB enrichment is a
documented later add-on (keeps v1 dependency-free).

### LibraryThing connector — dual-mode, one normalizer

Same connector, two input paths feeding one normalizer:

- **Endpoint mode:** `connect` stores `userid` + JSON-books `key`; `fetchItems`
  pages `api_getdata.php?userid=…&key=…&responseType=json&offset=…`.
- **File-import fallback:** if the endpoint returns non-200 / empty / disabled, the
  connection flips to `status: needs_reauth` with a message to upload the **Export
  Books** file; `fetchItems` then reads the uploaded JSON/TSV.

Books vs. ebooks distinguished by the export/format field. Collections map to
`status`/`lists` per the table above.

### Credential encryption (`crypto.ts`)

Core only hashes (one-way); OAuth tokens must be recoverable. AES-256-GCM, key from
`LIBRARY_ENCRYPTION_KEY` (32-byte base64) or HKDF-derived from `JWT_SECRET` when
unset. Stored value = `iv:authTag:ciphertext`. Decryption happens only in-memory
during sync; tokens are never returned over the API.

### Sync flow (manual)

`POST /api/v1/library/connections/:id/sync`:
1. Load connection, decrypt credentials.
2. `connector.fetchItems()` → normalized `LibraryItem[]`.
3. Idempotent upsert on `(connectionId, mediaType, externalId)`: insert new, update
   changed, **delete rows whose externalId vanished** from the source (removals
   propagate).
4. Update `lastSyncedAt`, `itemCount`; clear or set `lastSyncError`.

Runs inline in the request (collections are small). Errors are caught
per-connection so one bad account never breaks the shelf. `raw` is retained so a
later normalizer improvement can re-derive fields without re-fetching.

## Surfaces

### REST API (`/api/v1/library/*`, behind `requireAuth`, `ok`/`err` envelopes)

```
GET    /connections                     list (member, provider, status, counts — never creds)
POST   /connections/trakt/device        start Trakt device flow → {user_code, verification_url}
POST   /connections/trakt/device/poll   poll/finalize → creates connection when authorized
POST   /connections/librarything        create LT connection {userid, key}
POST   /connections/:id/import          upload LT export file (fallback path)
POST   /connections/:id/sync            manual "Sync now" → refreshed counts
DELETE /connections/:id                 remove connection (cascades its items)
GET    /items                           browse/filter: mediaType, memberId, provider, status, list, tag; paginated
GET    /items/search?q=                 search title/creators
GET    /items/:id                       detail (owning member + source link)
```

Filtering in SQL. Deleting a connection restricted to the owning member or an admin.

### Web UI (`web/src/pages/library.tsx` + `components/library/`)

TanStack Query + Router, shadcn ui.

- **Connections panel** — cards per account (member, provider, status badge,
  last-synced, item count, "Sync now", remove). "Connect" dialog: Trakt shows the
  device code + activate link and polls; LibraryThing takes userid/key with an
  "upload export instead" affordance.
- **Shelf** — responsive cover grid (placeholder when `coverUrl` null), filter bar
  (type / member / source / status / list incl. Favourites & Later), search box.
  Empty/loading/error states.
- **Detail** — drawer or route: metadata, owning member, rating, tags, lists, deep
  link to source.
- Added to dashboard nav.

### MCP tools (`mcp.ts`, `result()` wrapper pattern)

- `library.list_items` — filter by member/type/status/list/query.
- `library.search` — text search.
- `library.get_item` — detail by id.
- `library.list_connections` — accounts + sync status.
- `library.sync_connection` — trigger a sync.

Read/query-focused, enabling e.g. "what unread books does Anna have?" and
"what's on our watch-later list?".

## Testing (Vitest; backend/web split)

- **Connector unit tests** — fake HTTP layer; raw fixtures → normalized
  `LibraryItem[]` for Trakt (collection/watched/watchlist/favorites/ratings) and
  LibraryThing (endpoint JSON **and** export file). Covers token-refresh-on-401 and
  endpoint→file fallback.
- **crypto** — encrypt→decrypt round-trip; `JWT_SECRET`-derived fallback path.
- **Service/sync** — idempotent upsert (insert/update/delete-vanished);
  per-connection error isolation; provenance/counts; status vs. list mapping.
- **Routes** — auth required; device-flow endpoints; ownership checks on delete;
  filter/search correctness.
- **Web** — connections panel states and shelf filter/search render (following
  existing `meals.test.tsx`/`login.test.tsx` patterns).

## Out of scope for v1

Scheduled/background sync · cross-source dedup · Lismio audiobooks · TMDB cover
enrichment · write-back to any service.

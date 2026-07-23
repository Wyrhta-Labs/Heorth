# Library Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Heorth `library` module that mirrors a household's books, ebooks, movies, and series from Trakt (live OAuth) and LibraryThing (endpoint with export-file fallback) into one browsable, searchable shelf.

**Architecture:** Approach A — a single `Connector` interface with per-provider implementations that fetch and **normalize to a common `LibraryItem` shape**; the service owns all persistence, provenance, and an idempotent upsert. Routes → service → connectors + db; connectors never touch the DB. Read-only mirror, manual sync. Surfaces: REST + Web UI + MCP.

**Tech Stack:** TypeScript (ESM, NodeNext), Hono, Drizzle ORM + Postgres, Zod, `@wyrhta/core`, Vitest (backend); React 18 + TanStack Router/Query + Tailwind + shadcn-style ui (web).

## Global Constraints

- **Module pattern:** folder under `src/modules/library/` exporting a `HeorthModule` (`index.ts` with `register(app, mcp)`); files `schema.ts`, `service.ts`, `routes.ts`, `validators.ts`, `mcp.ts`, `crypto.ts`, `connectors/`.
- **Layering invariant:** routes → service → connectors + db. Routes never call connectors or `db` directly. Connectors never import `db`.
- **ESM imports:** all local imports use explicit `.js` extensions (e.g. `import { db } from '../../db/index.js'`).
- **Auth:** every route uses `requireAuth` from `../../wiring.js`; the principal is read via `c.get('auth').userId` / `.role`. Admin-or-owner checks use `c.get('auth')`.
- **Response envelopes:** `ok(c, data, meta?, status?)` and `err(c, code, message, status)` from `@wyrhta/core/http`. List meta: `{ total, limit?, offset? }`.
- **DB migrations:** after editing `schema.ts` and the schema barrel, generate with `npm run db:generate` and commit the generated SQL under `src/db/migrations/`.
- **Schema barrel:** every module table file must be re-exported from `src/db/schema/index.ts` so the single migration set covers it.
- **Read-only:** no write-back to Trakt/LibraryThing. No scheduled sync, no cross-source dedup, no Lismio, no TMDB enrichment in v1.
- **Normalized vocab:** `mediaType ∈ {book, ebook, movie, series}`; `status ∈ {unread, reading, read, watching, watched}` (nullable); `lists` entries ∈ `{later, favorites}`.
- **Secrets:** OAuth tokens / LT keys stored only as AES-256-GCM ciphertext in `credentials`; never returned over REST/MCP.
- **Tests:** Vitest. Backend tests live in `tests/*.test.ts` using `tests/helpers.ts` (`seedTestHousehold`, `authHeaders`, `invokeTool`). Web tests are colocated `*.test.tsx` mocking hooks.
- **Commits:** frequent, one per task minimum. No `Co-Authored-By` trailers.

---

## File Structure

**Backend (create):**
- `src/modules/library/crypto.ts` — AES-256-GCM encrypt/decrypt; key from env or HKDF(JWT_SECRET).
- `src/modules/library/schema.ts` — `libraryConnections`, `libraryItems` Drizzle tables + row types + vocab consts.
- `src/modules/library/connectors/types.ts` — `Connector`, `LibraryItem`, `RawConnection`.
- `src/modules/library/connectors/normalize.ts` — shared helpers (`makeSortTitle`, `mergeLists`, mapping tables).
- `src/modules/library/connectors/librarything.ts` — `LibraryThingConnector`.
- `src/modules/library/connectors/trakt.ts` — `TraktConnector` + device-flow helpers.
- `src/modules/library/service.ts` — connection CRUD, device-flow orchestration, sync, queries.
- `src/modules/library/validators.ts` — Zod schemas.
- `src/modules/library/routes.ts` — Hono routes.
- `src/modules/library/mcp.ts` — MCP tools.
- `src/modules/library/index.ts` — `libraryModule`.

**Backend (modify):**
- `src/config/env.ts` — add `TRAKT_CLIENT_ID?`, `TRAKT_CLIENT_SECRET?`, `LIBRARY_ENCRYPTION_KEY?`.
- `src/db/schema/index.ts` — re-export `../../modules/library/schema.js`.
- `src/modules/index.ts` — register `libraryModule`.

**Web (create):**
- `web/src/api/library.ts` — client wrappers + input types.
- `web/src/hooks/use-library.ts` — React Query hooks.
- `web/src/pages/library.tsx` — page.
- `web/src/components/library/connections-panel.tsx`, `connect-dialog.tsx`, `shelf.tsx`, `item-detail.tsx`.
- `web/src/pages/library.test.tsx` — page render/error test.

**Web (modify):**
- `web/src/lib/types.ts` — `LibraryConnection`, `LibraryItem`.
- `web/src/lib/constants.ts` — `QUERY_KEYS.library*`.
- `web/src/app.tsx` — register `/library` route.
- `web/src/components/layout/sidebar.tsx` — add nav item (+ heading map entry).

---

## Phase 0 — Foundations

### Task 1: Config env vars

**Files:**
- Modify: `src/config/env.ts`
- Test: `tests/env.test.ts` (append a case)

**Interfaces:**
- Produces: `config.traktClientId: string | undefined`, `config.traktClientSecret: string | undefined`, `config.libraryEncryptionKey: string | undefined`.

- [ ] **Step 1: Write the failing test** — append to `tests/env.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildEnvSchema } from '../src/config/env.js';

describe('library env vars', () => {
  const base = {
    DATABASE_URL: 'postgres://u:p@localhost:5432/db',
    JWT_SECRET: 'x'.repeat(32),
    HOUSEHOLD_NAME: 'Home',
    ADMIN_EMAIL: 'a@b.com',
    ADMIN_PASSWORD: 'pw',
  };

  it('accepts optional Trakt + encryption vars', () => {
    const parsed = buildEnvSchema().parse({
      ...base,
      TRAKT_CLIENT_ID: 'cid',
      TRAKT_CLIENT_SECRET: 'sec',
      LIBRARY_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    });
    expect(parsed.TRAKT_CLIENT_ID).toBe('cid');
    expect(parsed.LIBRARY_ENCRYPTION_KEY).toBeTypeOf('string');
  });

  it('is valid without any library vars set', () => {
    const parsed = buildEnvSchema().parse(base);
    expect(parsed.TRAKT_CLIENT_ID).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/env.test.ts`
Expected: FAIL — `buildEnvSchema` does not yet declare the new keys (or test file lacks the export path).

- [ ] **Step 3: Add fields to the schema and config** — in `src/config/env.ts`, add three lines to the `z.object({...})` returned by `buildEnvSchema` (after `DB_POOL_MAX`):

```ts
    TRAKT_CLIENT_ID: z.string().min(1).optional(),
    TRAKT_CLIENT_SECRET: z.string().min(1).optional(),
    LIBRARY_ENCRYPTION_KEY: z.string().min(1).optional(),
```

And add to the exported `config` object (after `dbPoolMax`):

```ts
  traktClientId: parsed.data.TRAKT_CLIENT_ID,
  traktClientSecret: parsed.data.TRAKT_CLIENT_SECRET,
  libraryEncryptionKey: parsed.data.LIBRARY_ENCRYPTION_KEY,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/env.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/config/env.ts tests/env.test.ts
git commit -m "feat(library): add Trakt + encryption env vars"
```

---

### Task 2: Credential encryption (`crypto.ts`)

**Files:**
- Create: `src/modules/library/crypto.ts`
- Test: `tests/library-crypto.test.ts`

**Interfaces:**
- Produces: `encryptSecret(plaintext: string): string`, `decryptSecret(ciphertext: string): string`. Stored format: `"<ivB64>:<tagB64>:<ctB64>"`. Key = base64-decoded `config.libraryEncryptionKey` (must be 32 bytes) else `hkdfSync('sha256', JWT_SECRET, salt, 'heorth-library-credentials', 32)`.

- [ ] **Step 1: Write the failing test** — `tests/library-crypto.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { encryptSecret, decryptSecret } from '../src/modules/library/crypto.js';

describe('library crypto', () => {
  it('round-trips a secret', () => {
    const secret = 'trakt-access-token-123';
    const enc = encryptSecret(secret);
    expect(enc).not.toContain(secret);
    expect(enc.split(':')).toHaveLength(3);
    expect(decryptSecret(enc)).toBe(secret);
  });

  it('produces different ciphertext each call (random IV)', () => {
    expect(encryptSecret('same')).not.toBe(encryptSecret('same'));
  });

  it('rejects tampered ciphertext', () => {
    const enc = encryptSecret('secret');
    const [iv, tag, ct] = enc.split(':');
    const flipped = `${iv}:${tag}:${Buffer.from(ct!, 'base64').toString('hex').replace(/.$/, '0')}`;
    expect(() => decryptSecret(flipped)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/library-crypto.test.ts`
Expected: FAIL — module `crypto.ts` does not exist.

- [ ] **Step 3: Implement `crypto.ts`**:

```ts
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { config } from '../../config/env.js';

const ALGO = 'aes-256-gcm';

/** Resolve a 32-byte key: explicit env key (base64) or HKDF over JWT_SECRET. */
function resolveKey(): Buffer {
  if (config.libraryEncryptionKey) {
    const key = Buffer.from(config.libraryEncryptionKey, 'base64');
    if (key.length !== 32) {
      throw new Error('LIBRARY_ENCRYPTION_KEY must decode to exactly 32 bytes');
    }
    return key;
  }
  // Deterministic fallback so the module works out-of-the-box. A dedicated key
  // is recommended in production (see startup warning below).
  const salt = Buffer.from('heorth-library-v1');
  return Buffer.from(hkdfSync('sha256', config.jwtSecret, salt, 'heorth-library-credentials', 32));
}

const KEY = resolveKey();

if (!config.libraryEncryptionKey) {
  console.warn(
    '[library] LIBRARY_ENCRYPTION_KEY not set — deriving credential key from JWT_SECRET. ' +
    'Set a dedicated 32-byte base64 key in production.',
  );
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, KEY, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

export function decryptSecret(stored: string): string {
  const [ivB64, tagB64, ctB64] = stored.split(':');
  if (!ivB64 || !tagB64 || !ctB64) throw new Error('Malformed ciphertext');
  const decipher = createDecipheriv(ALGO, KEY, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/library-crypto.test.ts`
Expected: PASS (3 passing).

- [ ] **Step 5: Commit**

```bash
git add src/modules/library/crypto.ts tests/library-crypto.test.ts
git commit -m "feat(library): AES-256-GCM credential encryption"
```

---

## Phase 1 — Data model & connector contract

### Task 3: Schema + migration

**Files:**
- Create: `src/modules/library/schema.ts`
- Modify: `src/db/schema/index.ts`
- Test: `tests/library-schema.test.ts`

**Interfaces:**
- Produces: tables `libraryConnections`, `libraryItems`; types `LibraryConnectionRow`, `LibraryItemRow`; consts `MEDIA_TYPES`, `ITEM_STATUSES`, `STANDARD_LISTS`, `PROVIDERS`, `CONNECTION_STATUSES`.

- [ ] **Step 1: Write the failing test** — `tests/library-schema.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/library-schema.test.ts`
Expected: FAIL — `schema.ts` missing.

- [ ] **Step 3: Implement `schema.ts`**:

```ts
import { pgTable, text, uuid, timestamp, integer, numeric, jsonb, unique, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from '@wyrhta/core/identity';

export const PROVIDERS = ['trakt', 'librarything'] as const;
export const CONNECTION_STATUSES = ['active', 'needs_reauth', 'error'] as const;
export const MEDIA_TYPES = ['book', 'ebook', 'movie', 'series'] as const;
export const ITEM_STATUSES = ['unread', 'reading', 'read', 'watching', 'watched'] as const;
export const STANDARD_LISTS = ['later', 'favorites'] as const;

export type Provider = (typeof PROVIDERS)[number];
export type MediaType = (typeof MEDIA_TYPES)[number];
export type ItemStatus = (typeof ITEM_STATUSES)[number];
export type StandardList = (typeof STANDARD_LISTS)[number];

export const libraryConnections = pgTable('library_connections', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  memberId: uuid('member_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  label: text('label').notNull(),
  externalRef: text('external_ref').notNull(),
  credentials: text('credentials'),
  status: text('status').notNull().default('active'),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  lastSyncError: text('last_sync_error'),
  itemCount: integer('item_count').notNull().default(0),
}, (t) => [
  unique('library_conn_unique').on(t.provider, t.externalRef, t.memberId),
  index('library_conn_member_idx').on(t.memberId),
]);

export const libraryItems = pgTable('library_items', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().default(sql`now()`),
  connectionId: uuid('connection_id').notNull().references(() => libraryConnections.id, { onDelete: 'cascade' }),
  mediaType: text('media_type').notNull(),
  externalId: text('external_id').notNull(),
  title: text('title').notNull(),
  sortTitle: text('sort_title').notNull(),
  creators: text('creators').array().notNull().default(sql`'{}'`),
  year: integer('year'),
  coverUrl: text('cover_url'),
  status: text('status'),
  lists: text('lists').array().notNull().default(sql`'{}'`),
  rating: numeric('rating'),
  tags: text('tags').array().notNull().default(sql`'{}'`),
  sourceUrl: text('source_url'),
  raw: jsonb('raw').notNull().default(sql`'{}'::jsonb`),
}, (t) => [
  unique('library_item_unique').on(t.connectionId, t.mediaType, t.externalId),
  index('library_item_conn_idx').on(t.connectionId),
  index('library_item_media_idx').on(t.mediaType),
]);

export type LibraryConnectionRow = typeof libraryConnections.$inferSelect;
export type LibraryItemRow = typeof libraryItems.$inferSelect;
```

- [ ] **Step 4: Register in the schema barrel** — add to `src/db/schema/index.ts` after the feoh line:

```ts
export * from '../../modules/library/schema.js';
```

- [ ] **Step 5: Generate the migration**

Run: `npm run db:generate`
Expected: a new file under `src/db/migrations/` containing `CREATE TABLE "library_connections"` and `"library_items"`. Ensure the test DB applies migrations (the Vitest `tests/setup.ts` runs them); if tests use `db:push`, run `npm run db:push` against the test DB.

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- tests/library-schema.test.ts`
Expected: PASS (2 passing).

- [ ] **Step 7: Commit**

```bash
git add src/modules/library/schema.ts src/db/schema/index.ts src/db/migrations
git commit -m "feat(library): connections + items schema and migration"
```

---

### Task 4: Connector contract + normalize helpers

**Files:**
- Create: `src/modules/library/connectors/types.ts`
- Create: `src/modules/library/connectors/normalize.ts`
- Test: `tests/library-normalize.test.ts`

**Interfaces:**
- Produces:
  - `LibraryItem` = `{ mediaType: MediaType; externalId: string; title: string; sortTitle: string; creators: string[]; year: number | null; coverUrl: string | null; status: ItemStatus | null; lists: StandardList[]; rating: number | null; tags: string[]; sourceUrl: string | null; raw: unknown }`
  - `RawConnection` = `{ id: string; provider: Provider; externalRef: string; credentials: string | null }`
  - `interface Connector { provider: Provider; connect(input: unknown): Promise<{ externalRef: string; label: string; credentials: string | null }>; fetchItems(conn: RawConnection): Promise<LibraryItem[]> }`
  - `makeSortTitle(title: string): string` — lowercase, strip leading `the/a/an ` and punctuation.
  - `mergeLists(...lists: StandardList[][]): StandardList[]` — dedup union preserving `STANDARD_LISTS` order.

- [ ] **Step 1: Write the failing test** — `tests/library-normalize.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { makeSortTitle, mergeLists } from '../src/modules/library/connectors/normalize.js';

describe('normalize helpers', () => {
  it('strips leading articles and lowercases for sortTitle', () => {
    expect(makeSortTitle('The Hobbit')).toBe('hobbit');
    expect(makeSortTitle('A Wizard of Earthsea')).toBe('wizard of earthsea');
    expect(makeSortTitle('Dune')).toBe('dune');
  });

  it('dedups and orders list membership', () => {
    expect(mergeLists(['favorites'], ['later', 'favorites'])).toEqual(['later', 'favorites']);
    expect(mergeLists([], [])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/library-normalize.test.ts`
Expected: FAIL — `normalize.ts` missing.

- [ ] **Step 3: Implement `types.ts`**:

```ts
import type { MediaType, ItemStatus, StandardList, Provider } from '../schema.js';

export interface LibraryItem {
  mediaType: MediaType;
  externalId: string;
  title: string;
  sortTitle: string;
  creators: string[];
  year: number | null;
  coverUrl: string | null;
  status: ItemStatus | null;
  lists: StandardList[];
  rating: number | null;
  tags: string[];
  sourceUrl: string | null;
  raw: unknown;
}

export interface RawConnection {
  id: string;
  provider: Provider;
  externalRef: string;
  credentials: string | null;
}

export interface Connector {
  provider: Provider;
  /** Validate user input; return externalRef + label + (encrypted) credentials. */
  connect(input: unknown): Promise<{ externalRef: string; label: string; credentials: string | null }>;
  /** Pull the whole account, already normalized. */
  fetchItems(conn: RawConnection): Promise<LibraryItem[]>;
}
```

- [ ] **Step 4: Implement `normalize.ts`**:

```ts
import { STANDARD_LISTS, type StandardList } from '../schema.js';

export function makeSortTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/^(the|a|an)\s+/, '')
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .trim();
}

export function mergeLists(...lists: StandardList[][]): StandardList[] {
  const seen = new Set<StandardList>(lists.flat());
  return STANDARD_LISTS.filter((l) => seen.has(l));
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/library-normalize.test.ts`
Expected: PASS (2 passing).

- [ ] **Step 6: Commit**

```bash
git add src/modules/library/connectors/types.ts src/modules/library/connectors/normalize.ts tests/library-normalize.test.ts
git commit -m "feat(library): connector contract and normalize helpers"
```

---

## Phase 2 — Connectors

### Task 5: LibraryThing connector (endpoint + file fallback)

**Files:**
- Create: `src/modules/library/connectors/librarything.ts`
- Test: `tests/library-librarything.test.ts`

**Interfaces:**
- Consumes: `Connector`, `LibraryItem`, `RawConnection` (Task 4); `encryptSecret`/`decryptSecret` (Task 2); `makeSortTitle`, `mergeLists` (Task 4).
- Produces:
  - `class LibraryThingConnector implements Connector` with constructor `(deps?: { fetch?: typeof fetch })`.
  - `connect(input: { userid: string; key: string })` → stores `{ userid, key }` JSON, encrypted.
  - `fetchItems(conn)` → tries endpoint; on any failure throws `LibraryThingEndpointError` (so the service can flip to `needs_reauth`).
  - `parseLibraryThingExport(json: unknown): LibraryItem[]` — exported for the file-import path (Task 7 calls it).
  - `class LibraryThingEndpointError extends Error`.

The LibraryThing "books" object shape (endpoint JSON and Export-Books JSON share it): an object keyed by book id → `{ books_id, title, authors?: [{ fl?: string; lf?: string }], isbn?: {...} | string, date?: string|number, rating?: number, collections?: Record<string,string> | string[], tags?: string[], format?: string, url?: string }`.

- [ ] **Step 1: Write the failing test** — `tests/library-librarything.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/library-librarything.test.ts`
Expected: FAIL — `librarything.ts` missing.

- [ ] **Step 3: Implement `librarything.ts`**:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/library-librarything.test.ts`
Expected: PASS (3 passing).

- [ ] **Step 5: Commit**

```bash
git add src/modules/library/connectors/librarything.ts tests/library-librarything.test.ts
git commit -m "feat(library): LibraryThing connector with endpoint + export parsing"
```

---

### Task 6: Trakt connector (device flow + fetch/merge)

**Files:**
- Create: `src/modules/library/connectors/trakt.ts`
- Test: `tests/library-trakt.test.ts`

**Interfaces:**
- Consumes: `Connector`, `LibraryItem`, `RawConnection`; `encryptSecret`/`decryptSecret`; `makeSortTitle`, `mergeLists`; `config.traktClientId`, `config.traktClientSecret`.
- Produces:
  - `class TraktConnector implements Connector` with constructor `(deps?: { fetch?: typeof fetch })`.
  - `requestDeviceCode(): Promise<{ device_code; user_code; verification_url; interval; expires_in }>`.
  - `pollForToken(deviceCode: string): Promise<{ status: 'pending' } | { status: 'authorized'; connection: { externalRef; label; credentials } }>`.
  - `connect(input)` is unused for Trakt (device flow drives creation via service); it throws `Error('use device flow')`.
  - `fetchItems(conn)` merges collection/watched/watchlist/favorites/ratings into `LibraryItem[]`; refreshes token on 401.

Trakt request headers: `{ 'Content-Type':'application/json', 'trakt-api-version':'2', 'trakt-api-key': clientId, Authorization: 'Bearer '+token }`. Endpoints (all `extended=full`): `/sync/collection/movies`, `/sync/collection/shows`, `/sync/watched/movies`, `/sync/watched/shows`, `/sync/watchlist/movies`, `/sync/watchlist/shows`, `/users/me/favorites/movies`, `/users/me/favorites/shows`, `/sync/ratings/movies`, `/sync/ratings/shows`. `movies` → `mediaType 'movie'`, `shows` → `'series'`.

- [ ] **Step 1: Write the failing test** — `tests/library-trakt.test.ts`:

```ts
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
    const items = await c.fetchItems(conn);

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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/library-trakt.test.ts`
Expected: FAIL — `trakt.ts` missing.

- [ ] **Step 3: Implement `trakt.ts`**:

```ts
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
    // Only the client ID is needed for the api-key header (not the secret), and
    // fetchItems must work under an injected fake fetch with no configured client,
    // so read the id directly with a fallback instead of requireClient().
    return { 'Content-Type': 'application/json', 'trakt-api-version': '2', 'trakt-api-key': config.traktClientId ?? '', Authorization: `Bearer ${token}` };
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/library-trakt.test.ts`
Expected: PASS (1 passing). Note: `probe` uses `/sync/last_activities` which the router maps to the default `[]` 200 response, so no refresh path is exercised here. `headers()` reads `config.traktClientId ?? ''` (not `requireClient()`) so `fetchItems` runs without configured Trakt env under the injected fake fetch.

- [ ] **Step 5: Commit**

```bash
git add src/modules/library/connectors/trakt.ts tests/library-trakt.test.ts
git commit -m "feat(library): Trakt connector (device flow + merged sync)"
```

---

## Phase 3 — Service & sync

### Task 7: Service — connections, device flow, file import

**Files:**
- Create: `src/modules/library/service.ts`
- Test: `tests/library-connections.test.ts`

**Interfaces:**
- Consumes: `db`; `libraryConnections`, `libraryItems` (Task 3); `LibraryThingConnector`, `parseLibraryThingExport`, `LibraryThingEndpointError` (Task 5); `TraktConnector` (Task 6); `encryptSecret` (Task 2).
- Produces (connection surface):
  - `listConnections(): Promise<PublicConnection[]>` — omits `credentials`.
  - `createLibraryThingConnection(memberId: string, input: { userid; key }): Promise<PublicConnection>`.
  - `startTraktDevice(): Promise<{ device_code; user_code; verification_url; interval; expires_in }>`.
  - `pollTraktDevice(memberId: string, deviceCode: string): Promise<{ status: 'pending' } | { status: 'authorized'; connection: PublicConnection }>`.
  - `importFile(memberId: string, connectionId: string, json: unknown): Promise<{ imported: number }>` — LibraryThing export path; also resolves `needs_reauth`.
  - `deleteConnection(id: string, actor: { userId; role }): Promise<{ id: string } | null>` — owner or admin only; returns `null` if not found, throws `'FORBIDDEN'` if not permitted.
  - `getConnectorFor(provider): Connector` — factory used by sync (Task 8).
  - Type `PublicConnection = Omit<LibraryConnectionRow, 'credentials'>`.

- [ ] **Step 1: Write the failing test** — `tests/library-connections.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/library-connections.test.ts`
Expected: FAIL — `service.ts` missing.

- [ ] **Step 3: Implement the connection half of `service.ts`** (sync/query added in Task 8 — write the whole file now with both halves referenced; sync functions land next task but declare `getConnectorFor` here):

```ts
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
  const items = parseLibraryThingExport(json);
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/library-connections.test.ts`
Expected: PASS (3 passing).

- [ ] **Step 5: Commit**

```bash
git add src/modules/library/service.ts tests/library-connections.test.ts
git commit -m "feat(library): connection service (create, device flow, import, delete)"
```

---

### Task 8: Service — sync (idempotent upsert) + queries

**Files:**
- Modify: `src/modules/library/service.ts`
- Test: `tests/library-sync.test.ts`

**Interfaces:**
- Consumes: `getConnectorFor` (Task 7); `LibraryThingEndpointError` (Task 5); `RawConnection`/`LibraryItem` (Task 4).
- Produces:
  - `syncConnection(id: string): Promise<PublicConnection>` — pulls, upserts new, updates changed, deletes vanished; updates `itemCount`/`lastSyncedAt`/`lastSyncError`; on `LibraryThingEndpointError` sets `status:'needs_reauth'` + error message and rethrows a tagged error; on `needsReauth` errors sets `needs_reauth`.
  - `listItems(q: { mediaType?; memberId?; provider?; status?; list?; tag?; limit?; offset? }): Promise<{ rows: ItemView[]; total: number; limit: number; offset: number }>`.
  - `searchItems(q: string, limit?: number): Promise<ItemView[]>`.
  - `getItem(id: string): Promise<ItemView | null>`.
  - `ItemView = LibraryItemRow & { memberId: string; provider: string }` (joined provenance).

- [ ] **Step 1: Write the failing test** — `tests/library-sync.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/library-sync.test.ts`
Expected: FAIL — `syncConnection`/`listItems`/`searchItems` not exported.

- [ ] **Step 3: Append sync + query functions to `service.ts`**:

```ts
import { and, eq, sql, inArray, ilike, desc } from 'drizzle-orm';
import { users } from '@wyrhta/core/identity';
import type { LibraryItemRow, MediaType, ItemStatus, StandardList } from './schema.js';
import type { LibraryItem, RawConnection } from './connectors/types.js';
import { LibraryThingEndpointError } from './connectors/librarything.js';

export type ItemView = LibraryItemRow & { memberId: string; provider: string };

function toInsert(connectionId: string, i: LibraryItem) {
  return {
    connectionId, mediaType: i.mediaType, externalId: i.externalId, title: i.title,
    sortTitle: i.sortTitle, creators: i.creators, year: i.year, coverUrl: i.coverUrl,
    status: i.status, lists: i.lists, rating: i.rating != null ? String(i.rating) : null,
    tags: i.tags, sourceUrl: i.sourceUrl, raw: i.raw as object,
  };
}

export async function syncConnection(id: string): Promise<PublicConnection> {
  const conn = await getRaw(id);
  if (!conn) throw new Error('NOT_FOUND');
  const connector = getConnectorFor(conn.provider);
  const raw: RawConnection = { id: conn.id, provider: conn.provider, externalRef: conn.externalRef, credentials: conn.credentials };

  let items: LibraryItem[];
  try {
    items = await connector.fetchItems(raw);
  } catch (e) {
    const needsReauth = e instanceof LibraryThingEndpointError || (e as { needsReauth?: boolean }).needsReauth;
    await db.update(libraryConnections).set({
      status: needsReauth ? 'needs_reauth' : 'error',
      lastSyncError: (e as Error).message, updatedAt: new Date(),
    }).where(eq(libraryConnections.id, id));
    throw e;
  }

  await db.transaction(async (tx) => {
    const seen: string[] = [];
    for (const i of items) {
      seen.push(`${i.mediaType}:${i.externalId}`);
      await tx.insert(libraryItems).values(toInsert(id, i)).onConflictDoUpdate({
        target: [libraryItems.connectionId, libraryItems.mediaType, libraryItems.externalId],
        set: {
          title: i.title, sortTitle: i.sortTitle, creators: i.creators, year: i.year,
          coverUrl: i.coverUrl, status: i.status, lists: i.lists,
          rating: i.rating != null ? String(i.rating) : null, tags: i.tags,
          sourceUrl: i.sourceUrl, raw: i.raw as object, syncedAt: new Date(), updatedAt: new Date(),
        },
      });
    }
    // Delete vanished rows for this connection.
    const existing = await tx.select().from(libraryItems).where(eq(libraryItems.connectionId, id));
    const toDelete = existing.filter((r) => !seen.includes(`${r.mediaType}:${r.externalId}`)).map((r) => r.id);
    if (toDelete.length) await tx.delete(libraryItems).where(inArray(libraryItems.id, toDelete));

    await tx.update(libraryConnections).set({
      status: 'active', lastSyncedAt: new Date(), lastSyncError: null, itemCount: items.length, updatedAt: new Date(),
    }).where(eq(libraryConnections.id, id));
  });
  return toPublic((await getRaw(id))!);
}

const ITEM_COLUMNS = {
  id: libraryItems.id, createdAt: libraryItems.createdAt, updatedAt: libraryItems.updatedAt,
  syncedAt: libraryItems.syncedAt, connectionId: libraryItems.connectionId, mediaType: libraryItems.mediaType,
  externalId: libraryItems.externalId, title: libraryItems.title, sortTitle: libraryItems.sortTitle,
  creators: libraryItems.creators, year: libraryItems.year, coverUrl: libraryItems.coverUrl,
  status: libraryItems.status, lists: libraryItems.lists, rating: libraryItems.rating,
  tags: libraryItems.tags, sourceUrl: libraryItems.sourceUrl, raw: libraryItems.raw,
  memberId: libraryConnections.memberId, provider: libraryConnections.provider,
} as const;

export async function listItems(q: {
  mediaType?: MediaType; memberId?: string; provider?: string; status?: ItemStatus; list?: StandardList; tag?: string;
  limit?: number; offset?: number;
}): Promise<{ rows: ItemView[]; total: number; limit: number; offset: number }> {
  const limit = Math.min(200, Math.max(1, q.limit ?? 50));
  const offset = Math.max(0, q.offset ?? 0);
  const conds = [
    q.mediaType ? eq(libraryItems.mediaType, q.mediaType) : undefined,
    q.memberId ? eq(libraryConnections.memberId, q.memberId) : undefined,
    q.provider ? eq(libraryConnections.provider, q.provider) : undefined,
    q.status ? eq(libraryItems.status, q.status) : undefined,
    q.list ? sql`${q.list} = ANY(${libraryItems.lists})` : undefined,
    q.tag ? sql`${q.tag} = ANY(${libraryItems.tags})` : undefined,
  ].filter(Boolean);
  const where = conds.length ? and(...(conds as any[])) : undefined;

  const rows = await db.select(ITEM_COLUMNS).from(libraryItems)
    .innerJoin(libraryConnections, eq(libraryItems.connectionId, libraryConnections.id))
    .where(where).orderBy(libraryItems.sortTitle).limit(limit).offset(offset);
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(libraryItems)
    .innerJoin(libraryConnections, eq(libraryItems.connectionId, libraryConnections.id)).where(where);
  return { rows: rows as ItemView[], total: count, limit, offset };
}

export async function searchItems(query: string, limit = 50): Promise<ItemView[]> {
  const rows = await db.select(ITEM_COLUMNS).from(libraryItems)
    .innerJoin(libraryConnections, eq(libraryItems.connectionId, libraryConnections.id))
    .where(sql`${libraryItems.title} ILIKE ${'%' + query + '%'} OR array_to_string(${libraryItems.creators}, ' ') ILIKE ${'%' + query + '%'}`)
    .orderBy(desc(libraryItems.updatedAt)).limit(limit);
  return rows as ItemView[];
}

export async function getItem(id: string): Promise<ItemView | null> {
  const [row] = await db.select(ITEM_COLUMNS).from(libraryItems)
    .innerJoin(libraryConnections, eq(libraryItems.connectionId, libraryConnections.id))
    .where(eq(libraryItems.id, id)).limit(1);
  return (row as ItemView) ?? null;
}
```

Note: consolidate the `drizzle-orm` and `@wyrhta/core/identity` imports with those already at the top of the file (do not duplicate import lines); the block above lists them for completeness. `ilike` may be unused — drop it if the linter flags it.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/library-sync.test.ts`
Expected: PASS (3 passing).

- [ ] **Step 5: Commit**

```bash
git add src/modules/library/service.ts tests/library-sync.test.ts
git commit -m "feat(library): idempotent sync + item queries"
```

---

## Phase 4 — Surfaces

### Task 9: Validators + routes + module registration

**Files:**
- Create: `src/modules/library/validators.ts`
- Create: `src/modules/library/routes.ts`
- Create: `src/modules/library/index.ts`
- Modify: `src/modules/index.ts`
- Test: `tests/library-routes.test.ts`

**Interfaces:**
- Consumes: service functions (Tasks 7–8); `ok`/`err`; `requireAuth`; `libraryTools` (Task 10 — imported by `index.ts`; create a temporary empty export first if implementing routes before MCP, then fill in Task 10).
- Produces: `libraryModule: HeorthModule` mounting `/api/v1/library`.

Routes (all `requireAuth`):
```
GET    /connections
POST   /connections/librarything          { userid, key }
POST   /connections/trakt/device          -> device code
POST   /connections/trakt/device/poll     { device_code }
POST   /connections/:id/import            raw JSON body (LT export)
POST   /connections/:id/sync
DELETE /connections/:id
GET    /items                             ?mediaType&memberId&provider&status&list&tag&limit&offset
GET    /items/search                      ?q
GET    /items/:id
```

- [ ] **Step 1: Write the failing test** — `tests/library-routes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app.js';
import { householdModule } from '../src/household/index.js';
import { libraryModule } from '../src/modules/library/index.js';
import { seedTestHousehold, authHeaders } from './helpers.js';

const app = createApp([householdModule, libraryModule]);

describe('library routes', () => {
  it('requires auth', async () => {
    const res = await app.request('/api/v1/library/connections');
    expect(res.status).toBe(401);
  });

  it('creates a LibraryThing connection and imports items', async () => {
    const { adult } = await seedTestHousehold();
    const create = await app.request('/api/v1/library/connections/librarything', {
      method: 'POST', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ userid: 'u1', key: 'k1' }),
    });
    expect(create.status).toBe(201);
    const conn = (await create.json() as { data: { id: string } }).data;

    const imp = await app.request(`/api/v1/library/connections/${conn.id}/import`, {
      method: 'POST', headers: authHeaders(adult.jwt),
      body: JSON.stringify({ '1': { books_id: '1', title: 'Dune', authors: [{ fl: 'Frank Herbert' }], collections: { a: 'Read' } } }),
    });
    expect(imp.status).toBe(200);

    const items = await app.request('/api/v1/library/items', { headers: authHeaders(adult.jwt) });
    const body = await items.json() as { data: unknown[]; meta: { total: number } };
    expect(body.meta.total).toBe(1);
  });

  it('rejects an invalid LibraryThing body', async () => {
    const { adult } = await seedTestHousehold();
    const res = await app.request('/api/v1/library/connections/librarything', {
      method: 'POST', headers: authHeaders(adult.jwt), body: JSON.stringify({ userid: '' }),
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/library-routes.test.ts`
Expected: FAIL — `index.ts`/`routes.ts` missing.

- [ ] **Step 3: Implement `validators.ts`**:

```ts
import { z } from 'zod';
import { MEDIA_TYPES, ITEM_STATUSES, STANDARD_LISTS, PROVIDERS } from './schema.js';

export const createLibraryThingSchema = z.object({
  userid: z.string().min(1),
  key: z.string().min(1),
});

export const pollDeviceSchema = z.object({ device_code: z.string().min(1) });

export const listItemsQuerySchema = z.object({
  mediaType: z.enum(MEDIA_TYPES).optional(),
  memberId: z.string().uuid().optional(),
  provider: z.enum(PROVIDERS).optional(),
  status: z.enum(ITEM_STATUSES).optional(),
  list: z.enum(STANDARD_LISTS).optional(),
  tag: z.string().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});

export type CreateLibraryThingInput = z.infer<typeof createLibraryThingSchema>;
```

- [ ] **Step 4: Implement `routes.ts`**:

```ts
import { Hono } from 'hono';
import { ok, err } from '@wyrhta/core/http';
import { requireAuth } from '../../wiring.js';
import * as service from './service.js';
import { createLibraryThingSchema, pollDeviceSchema, listItemsQuerySchema } from './validators.js';

export const libraryRouter = new Hono();
libraryRouter.use('*', requireAuth);

libraryRouter.get('/connections', async (c) => {
  return ok(c, await service.listConnections());
});

libraryRouter.post('/connections/librarything', async (c) => {
  const body = createLibraryThingSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'userid and key are required', 400);
  const conn = await service.createLibraryThingConnection(c.get('auth').userId, body.data);
  return ok(c, conn, undefined, 201);
});

libraryRouter.post('/connections/trakt/device', async (c) => {
  try {
    return ok(c, await service.startTraktDevice(), undefined, 201);
  } catch (e) {
    return err(c, 'TRAKT_UNCONFIGURED', (e as Error).message, 400);
  }
});

libraryRouter.post('/connections/trakt/device/poll', async (c) => {
  const body = pollDeviceSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'device_code required', 400);
  const result = await service.pollTraktDevice(c.get('auth').userId, body.data.device_code);
  if (result.status === 'pending') return ok(c, { status: 'pending' }, undefined, 202);
  return ok(c, result.connection, undefined, 201);
});

libraryRouter.post('/connections/:id/import', async (c) => {
  try {
    const json = await c.req.json();
    const res = await service.importFile(c.get('auth').userId, c.req.param('id'), json);
    return ok(c, res);
  } catch (e) {
    if ((e as Error).message === 'NOT_FOUND') return err(c, 'NOT_FOUND', 'Connection not found', 404);
    return err(c, 'IMPORT_FAILED', (e as Error).message, 400);
  }
});

libraryRouter.post('/connections/:id/sync', async (c) => {
  try {
    return ok(c, await service.syncConnection(c.req.param('id')));
  } catch (e) {
    if ((e as Error).message === 'NOT_FOUND') return err(c, 'NOT_FOUND', 'Connection not found', 404);
    return err(c, 'SYNC_FAILED', (e as Error).message, 502);
  }
});

libraryRouter.delete('/connections/:id', async (c) => {
  try {
    const deleted = await service.deleteConnection(c.req.param('id'), c.get('auth'));
    if (!deleted) return err(c, 'NOT_FOUND', 'Connection not found', 404);
    return ok(c, deleted);
  } catch (e) {
    if ((e as Error).message === 'FORBIDDEN') return err(c, 'FORBIDDEN', 'Not allowed', 403);
    throw e;
  }
});

libraryRouter.get('/items/search', async (c) => {
  const q = c.req.query('q') ?? '';
  if (!q) return err(c, 'VALIDATION_ERROR', 'q is required', 400);
  return ok(c, await service.searchItems(q));
});

libraryRouter.get('/items/:id', async (c) => {
  const item = await service.getItem(c.req.param('id'));
  if (!item) return err(c, 'NOT_FOUND', 'Item not found', 404);
  return ok(c, item);
});

libraryRouter.get('/items', async (c) => {
  const parsed = listItemsQuerySchema.safeParse(c.req.query());
  if (!parsed.success) return err(c, 'VALIDATION_ERROR', 'Invalid query', 400);
  const { rows, total, limit, offset } = await service.listItems(parsed.data);
  return ok(c, rows, { total, limit, offset });
});
```

Note: register `/items/search` and `/items/:id` **before** `/items` is fine in Hono (it matches by specificity), but keeping `search` above `:id` avoids `:id` capturing `search`. Verify the search test passes; if `:id` shadows, move `/items/search` above `/items/:id` (as written).

- [ ] **Step 5: Implement `index.ts`**:

```ts
import type { Hono } from 'hono';
import type { HeorthModule, McpRegistry } from '../registry.js';
import { libraryRouter } from './routes.js';
import { libraryTools } from './mcp.js';

export const libraryModule: HeorthModule = {
  name: 'library',
  register(app: Hono, mcp: McpRegistry): void {
    app.route('/api/v1/library', libraryRouter);
    mcp.add(...libraryTools);
  },
};
```

If implementing routes before Task 10, create a stub `src/modules/library/mcp.ts` now with `export const libraryTools = [] as import('@wyrhta/core/mcp').McpTool[];` and fill it in Task 10.

- [ ] **Step 6: Register the module** — add to `src/modules/index.ts`:

```ts
import { libraryModule } from './library/index.js';
```
and append `libraryModule,` to the `ALL_MODULES` array.

- [ ] **Step 7: Run test to verify it passes**

Run: `npm test -- tests/library-routes.test.ts`
Expected: PASS (3 passing).

- [ ] **Step 8: Commit**

```bash
git add src/modules/library/validators.ts src/modules/library/routes.ts src/modules/library/index.ts src/modules/library/mcp.ts src/modules/index.ts tests/library-routes.test.ts
git commit -m "feat(library): REST routes + module registration"
```

---

### Task 10: MCP tools

**Files:**
- Create/replace: `src/modules/library/mcp.ts`
- Test: `tests/library-mcp.test.ts`

**Interfaces:**
- Consumes: service query/sync functions; `invokeTool` (test helper).
- Produces: `libraryTools: McpTool[]` — `library.list_items`, `library.search`, `library.get_item`, `library.list_connections`, `library.sync_connection`.

- [ ] **Step 1: Write the failing test** — `tests/library-mcp.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { seedTestHousehold, invokeTool } from './helpers.js';
import { libraryTools } from '../src/modules/library/mcp.js';
import * as service from '../src/modules/library/service.js';
import * as ltMod from '../src/modules/library/connectors/librarything.js';

describe('library MCP tools', () => {
  it('lists items and connections', async () => {
    const { adult } = await seedTestHousehold();
    const conn = await service.createLibraryThingConnection(adult.user.id, { userid: 'u', key: 'k' });
    vi.spyOn(ltMod.LibraryThingConnector.prototype, 'fetchItems').mockResolvedValueOnce([{
      mediaType: 'book', externalId: '1', title: 'Dune', sortTitle: 'dune', creators: ['Frank Herbert'],
      year: 1965, coverUrl: null, status: 'read', lists: ['favorites'], rating: 5, tags: [], sourceUrl: null, raw: {},
    }]);
    await service.syncConnection(conn.id);

    const list = await invokeTool(libraryTools, 'library.list_items',
      { userId: adult.user.id, role: 'adult' }, { list: 'favorites' }) as { items: Array<{ title: string }> };
    expect(list.items[0]!.title).toBe('Dune');

    const conns = await invokeTool(libraryTools, 'library.list_connections',
      { userId: adult.user.id, role: 'adult' }, {}) as { connections: unknown[] };
    expect(conns.connections).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/library-mcp.test.ts`
Expected: FAIL — `libraryTools` empty/stub.

- [ ] **Step 3: Implement `mcp.ts`**:

```ts
import { z } from 'zod';
import type { McpTool, McpToolResult } from '@wyrhta/core/mcp';
import * as service from './service.js';
import { MEDIA_TYPES, ITEM_STATUSES, STANDARD_LISTS, PROVIDERS } from './schema.js';

function result(data: unknown): McpToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

export const libraryTools: McpTool[] = [
  {
    name: 'library.list_items',
    description: 'List library items across the household, filtered by media type, member, provider, status, or standard list (later/favorites).',
    inputSchema: {
      mediaType: z.enum(MEDIA_TYPES).optional(),
      memberId: z.string().uuid().optional(),
      provider: z.enum(PROVIDERS).optional(),
      status: z.enum(ITEM_STATUSES).optional(),
      list: z.enum(STANDARD_LISTS).optional(),
      tag: z.string().optional(),
      limit: z.number().int().positive().max(200).optional(),
    },
    async handler(_ctx, input) {
      const { rows, total } = await service.listItems(input as never);
      return result({ items: rows, total });
    },
  },
  {
    name: 'library.search',
    description: 'Full-text search library items by title or creator.',
    inputSchema: { q: z.string().min(1) },
    async handler(_ctx, input) {
      const items = await service.searchItems((input as { q: string }).q);
      return result({ items });
    },
  },
  {
    name: 'library.get_item',
    description: 'Get one library item by id, including owning member and source link.',
    inputSchema: { id: z.string().uuid() },
    async handler(_ctx, input) {
      const item = await service.getItem((input as { id: string }).id);
      if (!item) throw new Error('Item not found');
      return result(item);
    },
  },
  {
    name: 'library.list_connections',
    description: 'List connected library accounts and their sync status (never returns credentials).',
    inputSchema: {},
    async handler() {
      return result({ connections: await service.listConnections() });
    },
  },
  {
    name: 'library.sync_connection',
    description: 'Trigger a manual sync of one connected account.',
    inputSchema: { id: z.string().uuid() },
    async handler(_ctx, input) {
      return result(await service.syncConnection((input as { id: string }).id));
    },
  },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/library-mcp.test.ts`
Expected: PASS (1 passing).

- [ ] **Step 5: Full backend check + commit**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; all tests pass (including `module-convention.test.ts`, which validates every module registers cleanly).

```bash
git add src/modules/library/mcp.ts tests/library-mcp.test.ts
git commit -m "feat(library): MCP tools"
```

---

### Task 11: Web — types, API client, hooks

**Files:**
- Modify: `web/src/lib/types.ts`, `web/src/lib/constants.ts`
- Create: `web/src/api/library.ts`, `web/src/hooks/use-library.ts`

**Interfaces:**
- Produces:
  - types `LibraryConnection`, `LibraryItem` (web shapes).
  - `api`: `listConnections`, `createLibraryThingConnection`, `startTraktDevice`, `pollTraktDevice`, `importLibraryThingFile`, `syncConnection`, `deleteConnection`, `listItems`, `searchItems`, `getItem`.
  - hooks: `useConnections`, `useLibraryItems`, `useSearchLibrary`, `useCreateLibraryThing`, `useSyncConnection`, `useDeleteConnection`, `useImportFile`, `useStartTraktDevice`, `usePollTraktDevice`.

- [ ] **Step 1: Add web types** — append to `web/src/lib/types.ts`:

```ts
export type LibraryProvider = 'trakt' | 'librarything';
export type LibraryMediaType = 'book' | 'ebook' | 'movie' | 'series';
export type LibraryItemStatus = 'unread' | 'reading' | 'read' | 'watching' | 'watched';
export type LibraryList = 'later' | 'favorites';

export interface LibraryConnection {
  id: string;
  memberId: string;
  provider: LibraryProvider;
  label: string;
  externalRef: string;
  status: 'active' | 'needs_reauth' | 'error';
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  itemCount: number;
}

export interface LibraryItem {
  id: string;
  connectionId: string;
  memberId: string;
  provider: LibraryProvider;
  mediaType: LibraryMediaType;
  externalId: string;
  title: string;
  creators: string[];
  year: number | null;
  coverUrl: string | null;
  status: LibraryItemStatus | null;
  lists: LibraryList[];
  rating: string | null;
  tags: string[];
  sourceUrl: string | null;
}
```

- [ ] **Step 2: Add query keys** — in `web/src/lib/constants.ts`, add to the `QUERY_KEYS` object:

```ts
  libraryConnections: ['library', 'connections'] as const,
  libraryItems: ['library', 'items'] as const,
```

- [ ] **Step 3: Implement `web/src/api/library.ts`**:

```ts
import { apiGet, apiPost, apiDelete, qs } from './client';
import type { SingleResponse, ListResponse, LibraryConnection, LibraryItem } from '@/lib/types';

export interface ListItemsParams {
  mediaType?: string; memberId?: string; provider?: string; status?: string; list?: string; tag?: string;
  limit?: number; offset?: number;
}
export interface TraktDevice { device_code: string; user_code: string; verification_url: string; interval: number; expires_in: number; }

export function listConnections(): Promise<ListResponse<LibraryConnection>> {
  return apiGet('/library/connections');
}
export function createLibraryThingConnection(userid: string, key: string): Promise<SingleResponse<LibraryConnection>> {
  return apiPost('/library/connections/librarything', { userid, key });
}
export function startTraktDevice(): Promise<SingleResponse<TraktDevice>> {
  return apiPost('/library/connections/trakt/device', {});
}
export function pollTraktDevice(device_code: string): Promise<SingleResponse<LibraryConnection> | SingleResponse<{ status: 'pending' }>> {
  return apiPost('/library/connections/trakt/device/poll', { device_code });
}
export function importLibraryThingFile(id: string, json: unknown): Promise<SingleResponse<{ imported: number }>> {
  return apiPost(`/library/connections/${id}/import`, json);
}
export function syncConnection(id: string): Promise<SingleResponse<LibraryConnection>> {
  return apiPost(`/library/connections/${id}/sync`, {});
}
export function deleteConnection(id: string): Promise<SingleResponse<{ id: string }>> {
  return apiDelete(`/library/connections/${id}`);
}
export function listItems(params: ListItemsParams = {}): Promise<ListResponse<LibraryItem>> {
  return apiGet(`/library/items${qs(params as Record<string, unknown>)}`);
}
export function searchItems(q: string): Promise<ListResponse<LibraryItem>> {
  return apiGet(`/library/items/search${qs({ q })}`);
}
export function getItem(id: string): Promise<SingleResponse<LibraryItem>> {
  return apiGet(`/library/items/${id}`);
}
```

- [ ] **Step 4: Implement `web/src/hooks/use-library.ts`**:

```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { QUERY_KEYS } from '@/lib/constants';
import * as api from '@/api/library';

export function useConnections() {
  return useQuery({ queryKey: QUERY_KEYS.libraryConnections, queryFn: () => api.listConnections() });
}
export function useLibraryItems(params: api.ListItemsParams = {}) {
  return useQuery({ queryKey: [...QUERY_KEYS.libraryItems, params], queryFn: () => api.listItems(params) });
}
export function useSearchLibrary(q: string) {
  return useQuery({ queryKey: [...QUERY_KEYS.libraryItems, 'search', q], queryFn: () => api.searchItems(q), enabled: q.length > 0 });
}
export function useCreateLibraryThing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userid, key }: { userid: string; key: string }) => api.createLibraryThingConnection(userid, key),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.libraryConnections }),
  });
}
export function useSyncConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.syncConnection(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEYS.libraryConnections });
      qc.invalidateQueries({ queryKey: QUERY_KEYS.libraryItems });
    },
  });
}
export function useDeleteConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteConnection(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEYS.libraryConnections });
      qc.invalidateQueries({ queryKey: QUERY_KEYS.libraryItems });
    },
  });
}
export function useImportFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, json }: { id: string; json: unknown }) => api.importLibraryThingFile(id, json),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEYS.libraryConnections });
      qc.invalidateQueries({ queryKey: QUERY_KEYS.libraryItems });
    },
  });
}
export function useStartTraktDevice() {
  return useMutation({ mutationFn: () => api.startTraktDevice() });
}
export function usePollTraktDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (device_code: string) => api.pollTraktDevice(device_code),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.libraryConnections }),
  });
}
```

- [ ] **Step 5: Verify web build compiles**

Run: `cd web && npm run build`
Expected: TypeScript compiles (no missing-export errors). Return to repo root afterward.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/types.ts web/src/lib/constants.ts web/src/api/library.ts web/src/hooks/use-library.ts
git commit -m "feat(library): web types, api client, and query hooks"
```

---

### Task 12: Web — page, components, routing, nav

**Files:**
- Create: `web/src/pages/library.tsx`
- Create: `web/src/components/library/connections-panel.tsx`, `connect-dialog.tsx`, `shelf.tsx`, `item-detail.tsx`
- Modify: `web/src/app.tsx`, `web/src/components/layout/sidebar.tsx`
- Test: `web/src/pages/library.test.tsx`

**Interfaces:**
- Consumes: hooks from Task 11; existing ui primitives under `@/components/ui/*` (Button, Card, Dialog, Tabs, Input, Select, ErrorState, useToast) — mirror imports used in `web/src/pages/meals.tsx`.
- Produces: default-exported `LibraryPage`; a `/library` route; a sidebar nav entry.

- [ ] **Step 1: Write the failing test** — `web/src/pages/library.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const okList = { data: { data: [], meta: { total: 0 } }, isError: false, isLoading: false, refetch: vi.fn() };
const mutation = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };

vi.mock('@/hooks/use-library', () => ({
  useConnections: () => ({ ...okList, data: { data: [
    { id: 'c1', memberId: 'm1', provider: 'trakt', label: 'Anna’s Trakt', externalRef: 'anna',
      status: 'active', lastSyncedAt: null, lastSyncError: null, itemCount: 12 },
  ] } }),
  useLibraryItems: () => okList,
  useSearchLibrary: () => ({ ...okList }),
  useCreateLibraryThing: () => mutation,
  useSyncConnection: () => mutation,
  useDeleteConnection: () => mutation,
  useImportFile: () => mutation,
  useStartTraktDevice: () => mutation,
  usePollTraktDevice: () => mutation,
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import LibraryPage from './library';

describe('LibraryPage', () => {
  it('renders connected accounts and an empty shelf', () => {
    render(<LibraryPage />);
    expect(screen.getByText(/Anna.s Trakt/)).toBeInTheDocument();
    expect(screen.getByText(/12/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm test -- src/pages/library.test.tsx`
Expected: FAIL — `./library` page missing.

- [ ] **Step 3: Implement `connect-dialog.tsx`** (Trakt device flow + LibraryThing form + export upload):

```tsx
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import {
  useCreateLibraryThing, useStartTraktDevice, usePollTraktDevice,
} from '@/hooks/use-library';
import type { TraktDevice } from '@/api/library';

export default function ConnectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const createLT = useCreateLibraryThing();
  const startDevice = useStartTraktDevice();
  const pollDevice = usePollTraktDevice();
  const [userid, setUserid] = useState('');
  const [key, setKey] = useState('');
  const [device, setDevice] = useState<TraktDevice | null>(null);

  const connectLT = async () => {
    await createLT.mutateAsync({ userid, key });
    toast('LibraryThing connected', 'success');
    onClose();
  };

  const beginTrakt = async () => {
    const res = await startDevice.mutateAsync();
    setDevice(res.data);
    // Poll until authorized or expired.
    const started = Date.now();
    const tick = async () => {
      if (Date.now() - started > res.data.expires_in * 1000) { toast('Trakt code expired', 'error'); setDevice(null); return; }
      const poll = await pollDevice.mutateAsync(res.data.device_code);
      if ('status' in poll.data && poll.data.status === 'pending') {
        setTimeout(tick, res.data.interval * 1000);
      } else {
        toast('Trakt connected', 'success'); setDevice(null); onClose();
      }
    };
    setTimeout(tick, res.data.interval * 1000);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Connect an account</DialogTitle></DialogHeader>
        <Tabs defaultValue="trakt">
          <TabsList>
            <TabsTrigger value="trakt">Trakt</TabsTrigger>
            <TabsTrigger value="librarything">LibraryThing</TabsTrigger>
          </TabsList>
          <TabsContent value="trakt">
            {device ? (
              <div className="space-y-2">
                <p>Go to <a className="underline" href={device.verification_url} target="_blank" rel="noreferrer">{device.verification_url}</a> and enter:</p>
                <p className="text-2xl font-mono tracking-widest">{device.user_code}</p>
                <p className="text-sm text-muted-foreground">Waiting for authorization…</p>
              </div>
            ) : (
              <Button onClick={beginTrakt} disabled={startDevice.isPending}>Connect Trakt</Button>
            )}
          </TabsContent>
          <TabsContent value="librarything">
            <div className="space-y-2">
              <Input placeholder="LibraryThing user id" value={userid} onChange={(e) => setUserid(e.target.value)} />
              <Input placeholder="API key" value={key} onChange={(e) => setKey(e.target.value)} />
              <Button onClick={connectLT} disabled={!userid || !key || createLT.isPending}>Connect LibraryThing</Button>
              <p className="text-sm text-muted-foreground">If the LibraryThing API is unavailable, connect anyway then upload your Export Books file from the connection card.</p>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Implement `connections-panel.tsx`** (cards + sync/remove + export upload for `needs_reauth`):

```tsx
import { useRef } from 'react';
import { RefreshCw, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { useSyncConnection, useDeleteConnection, useImportFile } from '@/hooks/use-library';
import type { LibraryConnection } from '@/lib/types';

export default function ConnectionsPanel({ connections }: { connections: LibraryConnection[] }) {
  const { toast } = useToast();
  const sync = useSyncConnection();
  const remove = useDeleteConnection();
  const importFile = useImportFile();
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const onSync = async (id: string) => {
    try { await sync.mutateAsync(id); toast('Synced', 'success'); }
    catch (e) { toast((e as Error).message, 'error'); }
  };

  const onFile = async (id: string, file: File) => {
    const text = await file.text();
    let json: unknown;
    try { json = JSON.parse(text); } catch { toast('Not a valid JSON export', 'error'); return; }
    await importFile.mutateAsync({ id, json });
    toast('Imported', 'success');
  };

  if (connections.length === 0) return <p className="text-muted-foreground">No accounts connected yet.</p>;

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {connections.map((c) => (
        <Card key={c.id}>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">{c.label}</CardTitle>
            <span className={`text-xs rounded px-2 py-0.5 ${c.status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}`}>{c.status}</span>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-muted-foreground">{c.itemCount} items · {c.lastSyncedAt ? new Date(c.lastSyncedAt).toLocaleString() : 'never synced'}</p>
            {c.lastSyncError && <p className="text-sm text-red-600">{c.lastSyncError}</p>}
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => onSync(c.id)} disabled={sync.isPending}>
                <RefreshCw className="h-4 w-4 mr-1" /> Sync now
              </Button>
              {c.provider === 'librarything' && (
                <>
                  <input type="file" accept=".json,application/json" hidden
                    ref={(el) => { fileRefs.current[c.id] = el; }}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(c.id, f); }} />
                  <Button size="sm" variant="secondary" onClick={() => fileRefs.current[c.id]?.click()}>
                    <Upload className="h-4 w-4 mr-1" /> Upload export
                  </Button>
                </>
              )}
              <Button size="sm" variant="ghost" onClick={() => remove.mutate(c.id)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Implement `shelf.tsx`** (filter bar + grid; `item-detail.tsx` drawer):

```tsx
import { Card, CardContent } from '@/components/ui/card';
import type { LibraryItem } from '@/lib/types';

export default function Shelf({ items, onOpen }: { items: LibraryItem[]; onOpen: (item: LibraryItem) => void }) {
  if (items.length === 0) return <p className="text-muted-foreground py-8 text-center">Nothing here yet. Connect an account and sync.</p>;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
      {items.map((item) => (
        <Card key={item.id} className="cursor-pointer" onClick={() => onOpen(item)}>
          <CardContent className="p-2">
            <div className="aspect-[2/3] bg-muted rounded flex items-center justify-center overflow-hidden">
              {item.coverUrl
                ? <img src={item.coverUrl} alt={item.title} className="h-full w-full object-cover" />
                : <span className="text-xs text-muted-foreground text-center px-1">{item.title}</span>}
            </div>
            <p className="mt-1 text-sm font-medium truncate">{item.title}</p>
            <p className="text-xs text-muted-foreground truncate">{item.creators.join(', ')}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
```

```tsx
// item-detail.tsx
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { LibraryItem } from '@/lib/types';

export default function ItemDetail({ item, onClose }: { item: LibraryItem | null; onClose: () => void }) {
  return (
    <Dialog open={!!item} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        {item && (
          <>
            <DialogHeader><DialogTitle>{item.title}</DialogTitle></DialogHeader>
            <div className="space-y-1 text-sm">
              <p>{item.creators.join(', ')}{item.year ? ` · ${item.year}` : ''}</p>
              <p className="text-muted-foreground">{item.mediaType} · {item.status ?? '—'}{item.lists.length ? ` · ${item.lists.join(', ')}` : ''}</p>
              {item.rating && <p>Rating: {item.rating}</p>}
              {item.tags.length > 0 && <p className="text-muted-foreground">{item.tags.join(', ')}</p>}
              {item.sourceUrl && <a className="underline" href={item.sourceUrl} target="_blank" rel="noreferrer">View on source</a>}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 6: Implement `library.tsx`** (compose panel + filters + shelf + dialogs):

```tsx
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ErrorState } from '@/components/ui/error-state';
import { retryOf } from '@/lib/query-error';
import { useConnections, useLibraryItems } from '@/hooks/use-library';
import ConnectionsPanel from '@/components/library/connections-panel';
import ConnectDialog from '@/components/library/connect-dialog';
import Shelf from '@/components/library/shelf';
import ItemDetail from '@/components/library/item-detail';
import type { LibraryItem } from '@/lib/types';

const TYPES = ['', 'book', 'ebook', 'movie', 'series'];
const STATUSES = ['', 'unread', 'reading', 'read', 'watching', 'watched'];
const LISTS = ['', 'later', 'favorites'];

export default function LibraryPage() {
  const [connectOpen, setConnectOpen] = useState(false);
  const [selected, setSelected] = useState<LibraryItem | null>(null);
  const [mediaType, setMediaType] = useState('');
  const [status, setStatus] = useState('');
  const [list, setList] = useState('');
  const [q, setQ] = useState('');

  const connectionsQuery = useConnections();
  const itemsQuery = useLibraryItems({
    mediaType: mediaType || undefined, status: status || undefined, list: list || undefined,
    tag: undefined, limit: 200,
  });
  const retry = retryOf(connectionsQuery, itemsQuery);

  if (connectionsQuery.isError || itemsQuery.isError) {
    return <ErrorState title="Couldn’t load your library" onRetry={retry} />;
  }

  const connections = connectionsQuery.data?.data ?? [];
  const allItems = itemsQuery.data?.data ?? [];
  const items = q ? allItems.filter((i) =>
    i.title.toLowerCase().includes(q.toLowerCase()) ||
    i.creators.some((cr) => cr.toLowerCase().includes(q.toLowerCase()))) : allItems;

  const dropdown = (value: string, set: (v: string) => void, opts: string[], label: string) => (
    <Select value={value} onValueChange={(v) => set(v === '__all' ? '' : v)}>
      <SelectTrigger className="w-36"><SelectValue placeholder={label} /></SelectTrigger>
      <SelectContent>
        <SelectItem value="__all">All {label}</SelectItem>
        {opts.filter(Boolean).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
      </SelectContent>
    </Select>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Library</h1>
        <Button onClick={() => setConnectOpen(true)}><Plus className="h-4 w-4 mr-1" /> Connect</Button>
      </div>

      <ConnectionsPanel connections={connections} />

      <div className="flex flex-wrap gap-2 items-center">
        <Input placeholder="Search title or author" value={q} onChange={(e) => setQ(e.target.value)} className="w-56" />
        {dropdown(mediaType || '__all', setMediaType, TYPES, 'types')}
        {dropdown(status || '__all', setStatus, STATUSES, 'statuses')}
        {dropdown(list || '__all', setList, LISTS, 'lists')}
      </div>

      <Shelf items={items} onOpen={setSelected} />

      <ConnectDialog open={connectOpen} onClose={() => setConnectOpen(false)} />
      <ItemDetail item={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
```

Note: confirm the exact prop signature of `ErrorState` (`title`/`onRetry`) against `web/src/components/ui/error-state.tsx` and `retryOf` against `web/src/lib/query-error.ts`; adjust prop names to match if they differ (meals.tsx is the reference caller).

- [ ] **Step 7: Register the route** — in `web/src/app.tsx`:
  - add `import LibraryPage from '@/pages/library';`
  - add `const libraryRoute = createRoute({ getParentRoute: () => authRoute, path: '/library', component: LibraryPage });`
  - add `libraryRoute` to the `authRoute.addChildren([...])` array.

- [ ] **Step 8: Add nav** — in `web/src/components/layout/sidebar.tsx`:
  - add `Library` to the heading map: `'/library': 'Library',`
  - import an icon (e.g. `Library` from `lucide-react`) and add to `navItems`: `{ to: '/library', label: 'Library', icon: Library },`

- [ ] **Step 9: Run the web test + build**

Run: `cd web && npm test -- src/pages/library.test.tsx && npm run build`
Expected: page test passes; build compiles.

- [ ] **Step 10: Commit**

```bash
git add web/src/pages/library.tsx web/src/pages/library.test.tsx web/src/components/library web/src/app.tsx web/src/components/layout/sidebar.tsx
git commit -m "feat(library): web page, connect flow, shelf, and nav"
```

---

## Final verification

- [x] **Backend:** `npm run typecheck && npm test` — all green, including `module-convention.test.ts` and `integration-smoke.test.ts`.
- [x] **Web:** `cd web && npm test && npm run build` — all green.
- [ ] **Manual smoke (optional, needs a DB + Trakt app):** set `TRAKT_CLIENT_ID/SECRET`, `npm run dev:all`, connect a Trakt account via the device code, sync, and confirm items appear on the shelf; create a LibraryThing connection and upload an Export Books JSON to confirm the fallback path.

---

## Self-Review notes (author)

- **Spec coverage:** read-only mirror (no write endpoints) ✓; attributed-to-member connections + multiple per service (unique on provider+externalRef+memberId, memberId FK) ✓; no dedup (unique per connection) ✓; manual sync (sync route only) ✓; LibraryThing endpoint + file fallback (Task 5/7) ✓; Trakt device flow (Task 6/7/9) ✓; status vs. orthogonal lists (schema + normalize + mapping tables) ✓; REST+Web+MCP (Tasks 9/10/12) ✓; credential encryption + JWT fallback (Task 2) ✓; env optional (Task 1) ✓; out-of-scope items excluded (no scheduler, no TMDB, no Lismio, no cross-source dedup) ✓.
- **Type consistency:** `LibraryItem` shape identical across connectors, service `toInsert`, and web type (rating serialized as string via `numeric`); connection unique-target tuple identical in schema, `pollTraktDevice` upsert, and sync; MCP tool names match spec.
- **Known deviation:** `rating` is a Postgres `numeric` → returned as string in API/web (documented in web `LibraryItem.rating: string | null`).

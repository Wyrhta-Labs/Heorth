# CLAUDE.md — Heorth

The flagship self-hosted household system. Node.js 22 + TypeScript, Hono,
Drizzle ORM, PostgreSQL 16, Zod, Vitest. Consumes `@wyrhta/core` as a pinned
GitHub-tag dependency (not a workspace link). See `README.md` for the full
architecture, API surface, and the Feoh satellite proxy.

## Conventions

- **Modules** implement `HeorthModule` (`register(app, mcp)`) and are listed in
  `src/modules/index.ts` → `ALL_MODULES`. Routes mount under `/api/v1/<area>`;
  responses use `ok`/`err` from `@wyrhta/core/http`; auth via `requireAuth` /
  `requireRole` from `src/wiring.ts` (which sets the `auth` context key).
- **DB:** schema lives beside its module; register it in BOTH
  `src/db/schema/drizzle-schema.ts` (drizzle-kit, no `.js`) and
  `src/db/schema/index.js` (runtime barrel, `.js`). Generate migrations with
  `npm run db:generate -- --name <name>` — never hand-edit snapshots.
- **Tests** hit a real Postgres and truncate every table per test. `DATABASE_URL`
  MUST be exported before `npm test` (never a `_dev` database). External services
  are faked in-process and installed via a `set*Runtime` seam — never real
  network calls.

## Microsoft 365 area (`src/m365/`) — Phase 2

The **only** place Microsoft Graph types and URLs may appear. Providers in later
tasks (2.2 calendar, 2.3 To Do) consume the typed surface exported from
`src/m365/index.ts`; they must not import Graph URLs or reach the network
directly.

- **Enablement is all-or-nothing.** The six `M365_*` env vars are optional *as a
  group* (`src/config/env.ts`): all present → `config.m365` is populated and the
  routes mount; all absent → `config.m365` is `null`, the module registers as a
  **no-op** (zero impact — `/api/v1/m365/*` returns the catch-all 404); partial
  presence is a startup error. Adding an M365 env var means adding it to all of:
  the schema group, the `superRefine` all-or-nothing check, and the `config.m365`
  object.
- **Two auth modes.** Delegated (per-member auth-code flow) for calendars + To
  Do; app-only (client-credentials, `.default`) for the family shared mailbox.
  Access tokens are cached in memory with expiry; refresh tokens are stored
  **encrypted at rest** (`crypto.ts`, AES-256-GCM keyed off `JWT_SECRET`) and
  rotated on refresh. **Never log or return token material.**
- **Runtime seam.** Resolve dependencies through `getM365Runtime()` (singleton,
  built from `config.m365`). Tests install a fake-Graph-backed runtime via
  `setM365Runtime()` — mirror the Feoh pattern; do not call Graph in tests.
- **Sync state is generic.** `m365_sync_state` is keyed by a `feedKey` string
  built via `src/m365/feed-keys.ts` (`calendar:member:<id>`, `calendar:family`,
  `todo:member:<id>:<listId>`). Tasks 2.2/2.3 record delta tokens + failures
  there through `M365Store`.
- **Consumer surface** (`src/m365/index.ts`): `getM365Runtime`, `M365Runtime`
  (`{ config, store, delegated, appOnly, graphFetch }`), `feedKeys`, `M365Store`
  / `PublicM365Connection`, `graphFetch` / `GraphError` / `GRAPH_BASE`,
  `DELEGATED_SCOPES`, and the row/type exports.

## Common commands

```bash
npm run typecheck && npm run build
export DATABASE_URL=postgres://<user>:<pw>@localhost:<port>/heorth
npm test                         # backend suite (real Postgres)
cd web && npm test               # web suite
npx tsx scripts/m365-smoke.ts    # manual M365 app-only smoke (real .env)
```

Git operations against GitHub go through `gh`. Do not add AI co-author trailers
to commits.

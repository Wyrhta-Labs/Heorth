# Heorth

The flagship self-hosted household system in the Wyrhta Labs stack: household
membership, calendar, meal planning, and a media/book library, built with
Node.js 22 + TypeScript, Hono, Drizzle ORM, PostgreSQL 16, Zod, and Vitest.
Finance is not in-process — it is proxied to the independent **Feoh**
satellite service (its own repo and database); see
[Finance (Feoh satellite)](#finance-feoh-satellite) below.

## Quick start

Copy `.env.example` → `.env` and fill in real values:

```
DATABASE_URL=postgres://heorth:<password>@localhost:5432/heorth
JWT_SECRET=<32+ char random string>
HOUSEHOLD_NAME=Our Home
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=<password>
API_PORT=3000
JWT_TTL_SECONDS=604800
CORS_ORIGIN=*
DB_POOL_MAX=10
POSTGRES_PASSWORD=<password>

# Feoh satellite — required, both production and test
FEOH_BASE_URL=http://localhost:3001
FEOH_API_KEY=fe_change-me
```

`FEOH_BASE_URL`/`FEOH_API_KEY` point at a running Feoh instance and the
service API key Feoh issued for Heorth (`POST /api/v1/auth/keys` on Feoh).
Both are required at startup — `src/config/env.ts` validates the full set
with Zod and exits the process if anything is missing or malformed.

```bash
npm install
npm run docker:up      # API + PostgreSQL 16 via docker-compose.yml
# or, with your own Postgres running and DATABASE_URL pointed at it:
npm run dev             # API only (tsx watch src/index.ts)
npm run dev:all          # API + web dev server concurrently
```

Other scripts (`package.json`): `build` / `build:web` (compile), `start`
(run compiled output), `typecheck`, `db:generate` / `db:migrate` / `db:push`
/ `db:studio` (Drizzle, run via `tsx`), `docker:down`, `docker:reset`.

On boot, `bootstrap()` (`src/index.ts`) runs migrations, seeds the household
+ admin user (both idempotent), and best-effort syncs the member roster into
Feoh — a Feoh that's down at boot is logged and skipped, not fatal; the
finance proxy re-syncs lazily on first use (see below).

## API surface

REST is mounted under `/api/v1`, one router per module (`src/modules/index.ts`
lists `ALL_MODULES`):

| Prefix | Module | Notes |
|---|---|---|
| `/api/v1/household`, `/api/v1/members`, `/api/v1/auth` | `src/household/` | Household singleton, member CRUD/roles, login, `he_` API keys |
| `/api/v1/events` | `src/modules/calendar/` | Calendar with server-side recurrence expansion |
| `/api/v1/recipes`, `/api/v1/meals` | `src/modules/meals/` | Recipes, weekly meal plan, shopping list |
| `/api/v1/library` | `src/modules/library/` | Book/media library; Trakt + LibraryThing connectors |
| `/api/v1/feoh/*` | `src/satellites/feoh/` | Transparent proxy to the Feoh satellite (see below) — not a `HeorthModule`, mounted directly in `src/app.ts` |

`/mcp` (mounted in `src/index.ts`) exposes one MCP-over-HTTP server
(`@wyrhta/core`'s scaffold) assembling every module's tool registry plus a
`household.*` set, authenticated the same way as REST (`he_` API key or JWT).
Feoh's own finance MCP tools live on **Feoh's** `/mcp`, not Heorth's — they
were removed from Heorth's registry when finance was extracted (see
`CHANGELOG.md`).

The React web UI (`web/`) is served as static files from `web/dist` for any
unmatched non-API route.

## Finance (Feoh satellite)

Finance used to be an in-process module; it is now the independent **Feoh**
service, with Heorth mounting a transparent request proxy at the same
`/api/v1/feoh/*` paths (`src/satellites/feoh/`):

- `client.ts` / `satellite-client.ts` — thin HTTP client, service-API-key
  authenticated.
- `roster.ts` — maintains the Heorth-member ↔ Feoh-party id mapping
  (`FeohRoster`); syncs once at boot, lazily re-syncs (deduped across
  concurrent misses) on a cache miss, and is best-effort re-upserted right
  after a member's `displayName` changes (`household/service.ts#updateMember`
  — the one choke-point for member profile edits). Outside of those three
  paths, a renamed member's Feoh party can go stale until one of them fires —
  a known, accepted limitation, not a bug.
- `proxy.ts` — the router: forwards requests/responses verbatim except for
  the member-boundary fields (`createdBy`, split `memberId`/`partyId`).
  A Feoh 4xx/5xx passes through with its own envelope and status; an
  unreachable Feoh becomes Heorth's `503 SERVICE_UNAVAILABLE`; a roster
  mapping still missing after a successful re-sync becomes a
  `500 ROSTER_MAPPING_MISSING` (a different condition from "Feoh is down" —
  see the docstring in `proxy.ts`).

## Testing

Integration tests hit a real PostgreSQL database (`tests/setup.ts` runs
migrations and truncates every table before each test) and run in a single
fork to avoid parallel DB conflicts. **`DATABASE_URL` must be exported into
the shell manually before `npm test`** — it is not picked up from `.env`
automatically by the test run:

```bash
export DATABASE_URL=postgres://heorth:<password>@localhost:5432/heorth
npm test
```

`tests/setup.ts` also defaults `JWT_SECRET`/`HOUSEHOLD_NAME`/`ADMIN_EMAIL`/
`ADMIN_PASSWORD`/`FEOH_BASE_URL`/`FEOH_API_KEY` if unset, so only the
database connection needs to be supplied. Feoh-satellite tests
(`tests/feoh-proxy.test.ts`) never make a real network call — they install
an in-process fake Feoh (`tests/fake-feoh.ts`) via `setFeohRuntime`.

## Changelog

See [`CHANGELOG.md`](./CHANGELOG.md).

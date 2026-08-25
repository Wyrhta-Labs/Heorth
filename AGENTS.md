# AGENTS.md — Heorth

The flagship self-hosted household system. Node.js 22 + TypeScript, Hono,
Drizzle ORM, PostgreSQL 18, Zod, Vitest. Consumes `@wyrhta/core` from npm.

This file holds only the **rules** — the things you cannot infer from the code
and would get wrong by default. Descriptive detail (endpoints, env var meanings,
config walkthroughs, rotation procedures) lives in `README.md`; decisions live
in the meta repo's `docs/decisions/`. When the two disagree, the code wins and
both files are wrong — fix them.

## Architecture rules

- **Heorth is REST-only** (ADR 0008). **Never add an in-process MCP tool.**
  Anything a tool needs must be reachable over `/api/v1`, because the REST
  surface is the only path those tools have — the MCP surface is
  `Wyrhta-Labs/heorth-mcp`, a separate container that is a pure REST client.
  `@modelcontextprotocol/sdk` is not in the dependency tree, so such an import
  would not even resolve.
- **Modules** implement `HeorthModule` (`register(app)`) and are listed in
  `src/modules/index.ts` → `ALL_MODULES`. Routes mount under `/api/v1/<area>`;
  responses use `ok`/`err` from `@wyrhta/core/http`; auth via `requireAuth` /
  `requireRole` from `src/wiring.ts` (which sets the `auth` context key).
- **Optional integrations are gated as a GROUP, never per variable.** `M365_*`,
  `KITH_*` and `SATELLITE_SIGNING_*` each follow one pattern (`src/config/env.ts`):
  all present → the feature is configured and its routes mount; all absent → the
  module registers as a **no-op** with zero impact (routes fall through to the
  catch-all 404); **partial presence is a startup error.** Adding a var to an
  existing group means touching all three of the schema group, the `superRefine`
  all-or-nothing check, and the `config.<group>` object.
- **External dependencies resolve through a `get*Runtime()` / `set*Runtime()`
  seam** — `getM365Runtime`, `getKithRuntime`, `getSatelliteKeys`, `setTaskProvider`.
  Tests install in-process fakes through the setter. **Never call a real external
  service from a test.**

## Data rules

- **Schema** lives beside its module and must be registered in BOTH
  `src/db/schema/drizzle-schema.ts` (drizzle-kit, no `.js`) and
  `src/db/schema/index.js` (runtime barrel, `.js`). Generate migrations with
  `npm run db:generate -- --name <name>` — never hand-edit snapshots.
- **Never classify a query failure by reading `e.code`.** Since drizzle-orm 0.44
  every failed query is wrapped in a `DrizzleQueryError` whose own `code` is
  `undefined` and whose `cause` is the `postgres.PostgresError`, so a direct
  `e.code === '23505'` silently reads `undefined`, falls through, and turns a
  mapped 409 into a raw 500. Go through `pgErrorCode` / `isPgError`
  (`@wyrhta/core/db`), which walk the cause chain — in src *and* in tests.
- **Never derive a server-local date from `toISOString()`** — that yields the UTC
  date and misclassifies anything near local midnight. Use `localTodayIso()`
  (`src/modules/feoh/dates.ts`).
- **Store absolute UTC instants.** A source timezone is display metadata only.
- **Tests hit a real Postgres and truncate every table per test**, so
  `DATABASE_URL` MUST name a database **ending in `_test`** — `tests/setup.ts`
  enforces this as an allowlist and refuses everything else, including the
  primary `heorth` database. The fallback is `localhost:5432/heorth_test`.

## Module rules

- **Feoh** (`src/modules/feoh/`, ADR 0007) and **Ethel** (`src/modules/ethel/`,
  ADR 0013) are **always on**. There is no `FEOH_ENABLED` kill switch and no
  `GET /api/v1/features` check to consult — both mount unconditionally in
  `ALL_MODULES`. Do not reintroduce a gate.
- **Ethel does not depend on feoh.** The *only* sanctioned ethel→feoh touchpoint
  is a raw-SQL existence check (`hasDisposalLink` in `service.ts`, querying
  `feoh_item_costs.asset_id` directly — **no module import**) that blocks
  reactivating an asset with a recorded disposal link.
- **Weorc** (`src/modules/weorc/`, ADR 0014) is **always on** and — unlike Ethel
  — **deliberately depends on other modules.** It imports `tasks`' service
  (`createHouseholdTask`, `completeProjectedTask`, the two lookups) and reads
  Ethel's tables for an anchor's display name. **Do not "fix" this by applying
  Ethel's no-cross-module rule:** Weorc is the domain most entangled with Tasks,
  Ethel and Hearth View at once, which is exactly why ADR 0014 §8 makes it a
  built-in module rather than a satellite. The dependency runs one way —
  Weorc → tasks and Weorc → ethel, never the reverse.
- **Weorc's scheduler is NOT gated on the M365 integration.** `startWeorcScheduler`
  guards on `VITEST` only. Materialising due work, completing it and keeping its
  history are Heorth-native; only the projection pass degrades when no provider
  is installed, and **an absent provider writes no `projectionError`** — it is a
  normal state, not a failure.
- **A missing `task_mirror` row is NOT an upstream deletion.** Weorc's reconcile
  pass leaves an occurrence and its link untouched when the mirrored task cannot
  be found: `setAllowlist` deletes a whole feed's rows, and treating that as a
  deletion would re-project every projected occurrence into a duplicate task.
- **Weorc stores `(taskFeedKey, taskExternalId)`, never `task_mirror.id`** — a
  full resync deletes and re-inserts a feed's rows, so the uuid does not survive
  a 410 recovery.
- **Weorc's "today" is the HOUSEHOLD's**, via `householdToday()`
  (`src/modules/weorc/dates.ts`) → `localDateOf` + `getHouseholdTimeZone`.
  **Not `localTodayIso()`**, which is server-local.
- **An asset carries at most one detail row** — `ethel_vehicles` or
  `ethel_facilities`, never both (`409 ASSET_DETAIL_CONFLICT`). "The detail row
  exists" is the only signal of what kind of thing an asset is; `category` is
  free text. **`serviceIntervalMonths` on either table is documentation** — the
  interval the manufacturer states. Nothing in Heorth schedules from it; the
  routine that acts on it is Weorc's (ADR 0014).
- **KithLedger reminders** (`src/modules/kith/`) is a **stateless live proxy**
  (no DB) presenting the **`household`** credential — read-only and member-less.
  `requireAuth` authenticates the Heorth caller, but **that identity is NEVER
  forwarded upstream**, so the feed sees only the `household`-visible slice:
  fewer reminders than a member key would return, and an empty list is a normal
  200. `KithClient` issues **GETs only**. A member-scoped read would need a
  member JWT from `POST /api/v1/auth/satellite-token`; **no such call path
  exists, so none is built — do not add one speculatively.** Keep
  `KITH_CREDENTIAL_REJECTED` (upstream 401/403) distinct from
  `KITH_UNAVAILABLE`, so a misconfigured key never reads as an outage.
  → `README.md`, "Which principal this feed presents (ADR 0004 §2)".

## Token and key rules

- **The satellite signing key is separate from `JWT_SECRET`.** `JWT_SECRET`
  signs member logins and derives the M365 refresh-token encryption key; it must
  never leave this service or be reused for satellite tokens. Satellite tokens
  are signed with `getSatelliteKeys().signingKey`, and **no key means
  `503 SATELLITE_SIGNING_UNAVAILABLE` — never a fallback.**
- **`GET /.well-known/jwks.json` is unauthenticated and deliberately does NOT
  use the `ok()` envelope**, because generic JWKS clients read a bare
  `{"keys": [...]}`. Keys are cached for the process lifetime, so rotation needs
  a restart. → `README.md`, "Rotating the satellite signing key".
- **`sub`/`role` on a satellite token come from `c.get('auth')`, NEVER from the
  request body** (Zod strips the rest, so a smuggled `sub` is discarded).
  Audiences are an allowlist (`SATELLITE_AUDIENCES`); anything else is
  `400 UNKNOWN_AUDIENCE`. Both outcomes are audited via `logEvent`, **never with
  token material.** → `README.md`, "Token exchange".
- **Never log or return token material**, anywhere. Refresh tokens are stored
  encrypted at rest (`src/m365/crypto.ts`, AES-256-GCM keyed off `JWT_SECRET`)
  and rotated on refresh.

## Microsoft 365 rules (`src/m365/`)

- **`src/m365/` is the only place Microsoft Graph types and URLs may appear.**
  Consumers use the typed surface exported from `src/m365/index.ts`; they must
  not import Graph URLs or reach the network directly.
- **Provider contracts point inward.** The provider-agnostic contract
  (`CalendarProvider`/`MirroredEvent`, `TaskProvider`/`MirroredTask`) lives with
  its module (`src/modules/calendar/providers/`, `src/modules/tasks/providers/`)
  and the Graph implementation depends on it — **never the reverse**, so a
  Google/CalDAV provider slots in beside it with no Graph coupling. Task writes
  additionally go through `setTaskProvider` (`src/modules/tasks/provider.ts`) so
  that module never imports a Graph type, and failures surface as a Graph-free
  classified `TaskProviderError`.
- **Mirrored rows are SIBLING tables, never columns on the native table** —
  `calendar_mirror_events` beside `events`, `task_mirror` beside tasks, keyed by
  a `feedKey` from `src/m365/feed-keys.ts`.
- **Mirrored calendar events are read-only everywhere.** Mutation guards reject
  any id resolving to a mirror row (`EVENT_READ_ONLY` / `ReadOnlyEventError`).
  **Mirrored tasks are NOT** — completion writes back and Heorth creates tasks
  outward into the shared list. Do not copy the calendar's read-only assumption
  onto tasks.
- **To Do is delegated-only and allowlist-gated per member**
  (`todo_list_allowlist`) — **nothing syncs by default.**
- **The scheduler and sync runners never run under tests.** They start from
  `main()` in `src/index.ts`, guarded on `VITEST`; tests drive sync explicitly
  via `runCalendarSync` / `runTaskSync` or `POST /api/v1/m365/sync`.

## Common commands

```bash
npm run typecheck && npm run build
export DATABASE_URL=postgres://<user>:<pw>@localhost:<port>/heorth_test
npm test                         # backend suite (real Postgres, _test db only)
cd web && npm test               # web suite
npx tsx scripts/m365-smoke.ts    # manual M365 app-only smoke (real .env)
```

Git operations against GitHub go through `gh`. Do not add AI co-author trailers
to commits.

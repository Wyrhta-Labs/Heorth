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
  seam** — `getM365Runtime`, `getKithRuntime`, `getSatelliteKeys`. Tests install
  in-process fakes through the setter. **Never call a real external service
  from a test.**

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
  full resync now RECONCILES a feed's rows (upserts what's present, deletes
  what's absent) and preserves the uuid, but a mirror row is still deleted
  outright when a list leaves the allowlist or a task disappears at the
  source, and `(feedKey, externalId)` is the table's real provider key, so it
  is what survives either kind of churn.
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
  signs member logins and derives the integrations refresh-token encryption key
  (`src/integrations/crypto.ts`); it must never leave this service or be reused
  for satellite tokens. Satellite tokens
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
  encrypted at rest (`src/integrations/crypto.ts`, AES-256-GCM keyed off
  `JWT_SECRET`) and rotated on refresh.

## Integration provider rules (`src/integrations/`, `src/m365/`, `src/google/`)

- **Containment.** `src/m365/` is the only place Microsoft Graph types and URLs
  may appear; `src/google/` is live and is the only place Google API types and
  URLs may appear — confined to `src/google/api.ts`. The generic,
  provider-agnostic machinery — the registry, the connection/sync-state store,
  feed keys, crypto, routes — lives in `src/integrations/` and knows about
  neither provider. Consumers use the typed surface exported from
  `src/m365/index.ts` / `src/google/index.ts`; they must not import Graph or
  Google URLs or reach the network directly.
- **Provider contracts point inward.** The provider-agnostic contract
  (`CalendarProvider`/`MirroredEvent`, `TaskProvider`/`MirroredTask`) lives with
  its module (`src/modules/calendar/providers/`, `src/modules/tasks/providers/`)
  and the Graph implementation depends on it — **never the reverse**, so a
  Google provider slots in beside it with no Graph coupling. Task writes
  resolve through the integrations registry by the mirror row's `source` column
  (`getTaskProviderFor`, `src/integrations/registry.ts`), so a Google-mirrored
  task's completion reaches Google and the tasks module never imports a Graph
  type; failures surface as a Graph-free classified `TaskProviderError`.
- **Mirrored rows are SIBLING tables, never columns on the native table** —
  `calendar_mirror_events` beside `events`, `task_mirror` beside tasks, keyed by
  a `feedKey` from `src/integrations/feed-keys.ts`.
- **Feed keys are NOT opaque — they carry a provider segment and are parsed in
  several places**: `src/m365/calendar-provider.ts` and `src/m365/task-provider.ts`
  parse them to recover the member/list they belong to, and on the web,
  `hearth.ts`'s `ownerOfFeed()` and `isFamilyEvent()` parse them to attribute
  events/tasks to a member or the family feed for the Hearth View. Changing the
  feed-key format means changing all of those call sites, not just
  `feed-keys.ts`. **The Google providers deliberately do NOT parse feed keys.**
  `src/google/calendar-provider.ts` and `src/google/task-provider.ts` resolve a
  feed by looking up its `calendar_allowlist` / `todo_list_allowlist` row
  (`getCalendarFeedByKey`, `getTaskFeedByKey`) instead, because a Google
  calendar id is email-shaped and would split if parsed the M365 way. Making
  the M365 providers resolve the same way is still a worthwhile follow-up.
- **Never change the HKDF salt or info strings in `src/integrations/crypto.ts`.**
  They are inputs to the key derived from `JWT_SECRET`; changing either makes
  every stored refresh token undecryptable. They still say `m365` for exactly
  that reason — it long predates the Google provider and renaming it buys
  nothing but a decryption outage.
- **The household task list is designated by `todo_list_allowlist.is_household`,
  not by name.** There is no `M365_SHARED_TODO_LIST`; `PUT
  /api/v1/tasks/household-list` sets the flag on one allowlisted list.
- **Mirrored calendar events are read-only everywhere.** Mutation guards reject
  any id resolving to a mirror row (`EVENT_READ_ONLY` / `ReadOnlyEventError`).
  **Mirrored tasks are NOT** — completion writes back and Heorth creates tasks
  outward into the household list. Do not copy the calendar's read-only
  assumption onto tasks.
- **To Do is delegated-only and allowlist-gated per member**
  (`todo_list_allowlist`) — **nothing syncs by default.**
- **Optional-as-a-group credentials.** `M365_*` is now **five** variables
  (`M365_TENANT_ID`, `M365_CLIENT_ID`, `M365_CLIENT_SECRET`,
  `M365_REDIRECT_URI`, `M365_FAMILY_MAILBOX`); `GOOGLE_*` is a sibling
  **three**-variable group (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
  `GOOGLE_REDIRECT_URI`), each gated the same all-or-nothing way as any other
  optional integration (see the architecture rule above).
  `INTEGRATIONS_SYNC_INTERVAL_SECONDS` (renamed from `M365_SYNC_INTERVAL_SECONDS`)
  is a tuning knob **outside both credential groups**, not a credential — and so
  is `GOOGLE_FULL_RESYNC_INTERVAL_SECONDS`, read straight from `process.env`
  beside `M365_FULL_RESYNC_INTERVAL_SECONDS`.
- **The scheduler and sync runners never run under tests.** They start from
  `main()` in `src/index.ts`, guarded on `VITEST`; tests drive sync explicitly
  via `runCalendarSync` / `runTaskSync` or `POST /api/v1/integrations/sync`.
  `/api/v1/m365/*` no longer exists; the connection and sync routes mount at
  `/api/v1/integrations/*`, with a provider segment on the connection routes
  (e.g. `/api/v1/integrations/m365/callback`).
- **`src/m365/sync-runner.ts` runs nothing** despite the name — it holds the
  Graph error classifier (`classify`) and the M365 full-resync interval
  helper, both consumed by `src/integrations/sync-runner.ts`'s generic runner.
  The name is stale but out of scope to rename here. `src/google/sync-runner.ts`
  is its sibling: same shape (`classify`, `googleFullResyncIntervalMs`), same
  underlying `src/integrations/sync-runner.ts` runner, and equally runs
  nothing.
- **Google Tasks pulls a SNAPSHOT, never a delta.**
  `GoogleTaskProvider.pullChanges` ignores the sync token and reports
  `fullResync: true` on every pull; `applyTaskPull` reconciles. Do not
  "optimise" this into an `updatedMin` delta — deletions would then depend on
  Google's tombstone retention and a task deleted on a phone would stay
  mirrored forever. `showCompleted=true&showHidden=true` are both mandatory:
  without them a completion reads as a deletion (a completed task is hidden by
  default).
- **The Google family calendar is a designated allowlist row**,
  `calendar_allowlist.is_household`, on ONE member's delegated connection —
  there is no app-only Google client and no `GOOGLE_FAMILY_*` env. It stops
  syncing the moment that member disconnects;
  `/api/v1/integrations/status`'s `householdCalendar.connectionOk` is where
  that shows.

## Common commands

```bash
npm run typecheck && npm run build
export DATABASE_URL=postgres://<user>:<pw>@localhost:<port>/heorth_test
npm test                         # backend suite (real Postgres, _test db only)
cd web && npm test               # web suite
cd web && npm run build          # web TYPECHECK + build — see below, do not skip
npx tsx scripts/m365-smoke.ts    # manual M365 app-only smoke (real .env)
```

- **`cd web && npm run build` is the ONLY thing that typechecks the web.** The root
  `tsconfig.json` includes `src/**/*` only, and `web/` has no `typecheck` script — its
  `tsc -b` runs inside `build`. So `npm run typecheck && npm test && (cd web && npm test)`
  can be entirely green while `web/` does not compile, and CI then fails on a push that
  every local check passed. This has happened; run the web build before you push.

Git operations against GitHub go through `gh`. Do not add AI co-author trailers
to commits.

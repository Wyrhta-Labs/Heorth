# CLAUDE.md — Heorth

The flagship self-hosted household system. Node.js 22 + TypeScript, Hono,
Drizzle ORM, PostgreSQL 18, Zod, Vitest. Consumes `@wyrhta/core` as a pinned
GitHub-tag dependency (not a workspace link). See `README.md` for the full
architecture and API surface.

## Conventions

- **Heorth is REST-only** (ADR 0008, task A7). The embedded MCP server was
  deleted 2026-08-18; the MCP surface is `Wyrhta-Labs/heorth-mcp`, a separate
  container that is a pure REST client. Never add an in-process MCP tool here —
  anything a tool needs must be reachable over `/api/v1`, and the REST surface
  is now the only path those tools have.
  Since `@wyrhta/core` v0.3.0 (task A9) core no longer ships an `./mcp` entry
  point and `@modelcontextprotocol/sdk` is not in Heorth's dependency tree at
  all — an MCP import here would not even resolve.
- **Modules** implement `HeorthModule` (`register(app)`) and are listed in
  `src/modules/index.ts` → `ALL_MODULES`. Routes mount under `/api/v1/<area>`;
  responses use `ok`/`err` from `@wyrhta/core/http`; auth via `requireAuth` /
  `requireRole` from `src/wiring.ts` (which sets the `auth` context key).
- **DB:** schema lives beside its module; register it in BOTH
  `src/db/schema/drizzle-schema.ts` (drizzle-kit, no `.js`) and
  `src/db/schema/index.js` (runtime barrel, `.js`). Generate migrations with
  `npm run db:generate -- --name <name>` — never hand-edit snapshots.
  **Never classify a query failure by reading `e.code`** — since drizzle-orm
  0.44 every failed query is wrapped in a `DrizzleQueryError` whose own `code`
  is `undefined` and whose `cause` is the `postgres.PostgresError`, so a direct
  `e.code === '23505'` silently reads `undefined`, falls through, and turns a
  mapped 409 into a raw 500. Go through `pgErrorCode` / `isPgError`
  (`src/db/pg-errors.ts`), which walk the cause chain — in src *and* in tests.
- **Tests** hit a real Postgres and truncate every table per test. `DATABASE_URL`
  MUST point at a database whose **name ends in `_test`** — `tests/setup.ts`
  enforces this as an allowlist and refuses anything else, including the primary
  `heorth` database. Export it before `npm test`; the fallback is
  `localhost:5432/heorth_test` (the `heorth` role on the shared dev cluster from
  the meta repo's `deploy/` stack). External services
  are faked in-process and installed via a `set*Runtime` seam — never real
  network calls.
- **Feoh finance module** (`src/modules/feoh/`, ADR 0007) is **always on** —
  the `FEOH_ENABLED` kill switch was removed 2026-08-17; `feohModule` mounts
  unconditionally in `ALL_MODULES` (`src/modules/index.ts`), no env var or
  `GET /api/v1/features` check required. It covers envelopes, accounts,
  double-entry transactions, and recurring bills, plus three surfaces added
  alongside the inventory lifecycle work:
  - **Recurring occurrences** (`src/modules/feoh/occurrences.ts`) — a bill's
    cadence is projected into due-date entries (`planned`/`overdue`/`paid`/
    `skipped`/`unknown`), persisting a `recurring_occurrences` row only once
    an entry is touched (linked/skipped/overridden); untouched rows are pure
    projection and are pruned back to nothing once un-touched again.
  - **Item costs / TCO** (`src/modules/feoh/item-costs.ts`) — links a
    transaction to an inventory item as a cost (`purchase`/`disposal`/
    `repair`/`maintenance`/`accessory`) and rolls up a per-item total-cost-of-
    ownership breakdown (capital + tier2 + recurring − proceeds, plus a
    per-year rate over the item's lifetime).
  - **Account ledger + Kassensturz** (`src/modules/feoh/ledger.ts`) — a
    per-account running-balance ledger (Postgres window function over the
    full unfiltered history so paginated balances stay correct) and a
    reconciliation flow that books an adjusting transaction between a
    physically counted balance and the ledger balance.
  - A shared `localTodayIso()` helper (`src/modules/feoh/dates.ts`) gives both
    item-costs and ledger the same server-local "today" (never
    `toISOString()`'s UTC date, which misclassifies dates around local
    midnight).
- **Inventory module** (`src/modules/inventory/`) is a standalone,
  **always-on** `HeorthModule` — household items with lifecycle fields
  (purchase, warranty, decommission/reactivation). It has no dependency on
  feoh; the *only* sanctioned inventory→feoh touchpoint is a raw-SQL
  existence check (`hasDisposalLink` in `service.ts`, querying
  `feoh_item_costs` directly — no module import) that blocks reactivating an
  item with a recorded disposal link.
- **KithLedger reminders module** (`src/modules/kith/`) is env-gated via the
  `KITH_BASE_URL` + `KITH_API_KEY` group — optional AS A GROUP like `M365_*`
  (both present → enabled; both absent → no-op, routes 404, `kithledger: false`
  in `GET /api/v1/features`; partial presence is a startup error). It is a
  **stateless live proxy** (no DB): `GET /api/v1/kith/reminders
  ?from&to` calls KithLedger's `GET /api/v1/reminders` with the service API key
  through `KithClient` (`client.ts`, the resurrected satellite-client transport),
  windows on the effective due (`snoozedUntil` when snoozed) Heorth-side (the
  upstream API has no lower-bound filter), and maps upstream failure to
  502 `KITH_UNAVAILABLE`.
  **The credential is the `household` one** (B8, ADR 0004 §2.2): the feed is
  always-on with no logged-in member — `requireAuth` authenticates the Heorth
  caller but that identity is NEVER forwarded upstream — so it presents the
  read-only, member-less household dashboard key and sees only the
  `household`-visible slice (fewer reminders than a member key; that is
  correct, and an empty list is a normal 200). `KITH_API_KEY_KIND` declares
  this (only `household` is accepted; Heorth cannot introspect a `kl_` key's
  kind, so it is a declaration, not a check) and `config.kith.keyKind` carries
  it. Nothing here writes — `KithClient` issues GETs only. A member-scoped read
  would need a member JWT from `POST /api/v1/auth/satellite-token` (ADR 0009)
  rather than this key; **no such call path exists, so none is built** — do not
  add one speculatively. An upstream 401/403 is a `KithCredentialError` →
  502 `KITH_CREDENTIAL_REJECTED`, deliberately distinct from
  `KITH_UNAVAILABLE` so a misconfigured key never reads as an outage.
  Dependencies resolve through `getKithRuntime()` /
  `setKithRuntime()` — tests install a fake KithLedger (`tests/fake-kith.ts`);
  gating toggles follow the feoh/M365 `vi.resetModules()` pattern
  (`tests/kith-gating.test.ts`).

- **Satellite identity keys** (`src/satellite/keys.ts`, `src/routes/jwks.ts`,
  task B1c) — Heorth signs satellite-service tokens with an ASYMMETRIC private
  key and publishes the public half at the **unauthenticated**
  `GET /.well-known/jwks.json`. Env-gated via `SATELLITE_SIGNING_KEY` +
  `SATELLITE_SIGNING_KID` (optional AS A GROUP like `M365_*`/`KITH_*`; absent →
  `{"keys": []}` and zero behavior change), with `SATELLITE_SIGNING_ALG`
  (`EdDSA` default / `RS256`) and a publish-only rotation-overlap slot
  (`*_SECONDARY`) that also accepts PUBLIC material. Two hard rules: this key is
  **separate from `JWT_SECRET`** (which signs member logins and derives the M365
  refresh-token encryption key — it must never leave this service or be reused
  here), and the JWKS route deliberately does **not** use the `ok()` envelope,
  because generic JWKS clients read a bare `{"keys": [...]}`. Keys resolve
  through `getSatelliteKeys()` / `setSatelliteKeys()` (the usual runtime seam,
  cached for the process lifetime — rotation needs a restart). The
  Rotation procedure: README.md, "Rotating the satellite signing key".

- **Satellite token exchange** (`src/satellite/token.ts`, the route in
  `src/household/routes.ts`, task B3 / ADR 0009) — `POST /api/v1/auth/
  satellite-token` trades a credential Heorth already accepts (`he_` key OR
  member JWT, via `requireAuth`) for a **5-minute** member token bound to one
  satellite: `{ sub, role, iss: 'heorth', aud, iat, exp }` plus `expires_in`
  in the envelope. Non-negotiables: `sub`/`role` come from `c.get('auth')` and
  NEVER from the body (Zod strips the rest, so a smuggled `sub` is discarded);
  it is signed with `getSatelliteKeys().signingKey` and **never `JWT_SECRET`**
  — no key means `503 SATELLITE_SIGNING_UNAVAILABLE`, never a fallback. Known
  audiences are the `SATELLITE_AUDIENCES` env allowlist (comma-separated
  lowercase slugs, empty by default, orphaned without the signing key group);
  anything else is `400 UNKNOWN_AUDIENCE`. Rate-limited per IP at 60/15min
  (wider than `/auth/token`: the caller is heorth-mcp, one IP for the whole
  household). Both outcomes are audited via `logEvent`
  (`auth.satellite_token.issued` / `.refused`), never with token material.
  The audience allowlist has the usual seam (`getSatelliteAudiences()` /
  `setSatelliteAudiences()`).

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
  `setM365Runtime()` — this `get*Runtime`/`set*Runtime` seam is the reference
  pattern for faking any external dependency; do not call Graph in tests.
- **Sync state is generic.** `m365_sync_state` is keyed by a `feedKey` string
  built via `src/m365/feed-keys.ts` (`calendar:member:<id>`, `calendar:family`,
  `todo:member:<id>:<listId>`). Tasks 2.2/2.3 record delta tokens + failures
  there through `M365Store`.
- **Consumer surface** (`src/m365/index.ts`): `getM365Runtime`, `M365Runtime`
  (`{ config, store, delegated, appOnly, graphFetch }`), `feedKeys`, `M365Store`
  / `PublicM365Connection`, `graphFetch` / `GraphError` / `GRAPH_BASE`,
  `DELEGATED_SCOPES`, and the row/type exports.
- **Calendar mirror (Task 2.2).** The provider-agnostic contract
  (`CalendarProvider`, `MirroredEvent`) lives with the calendar module
  (`src/modules/calendar/providers/`); the Graph implementation
  (`src/m365/calendar-provider.ts`) depends on it, never the reverse (so a future
  Google/CalDAV provider slots in beside it with no Graph coupling). Mirrored
  events are a **sibling** table `calendar_mirror_events` (NOT columns on
  `events`), merged into the calendar service's range query and **read-only
  everywhere** — the mutation guards reject any id resolving to a mirror
  row (`EVENT_READ_ONLY` / `ReadOnlyEventError`). The sync runner
  (`calendar-sync.ts`) + scheduler (`scheduler.ts`) inherit the enablement gate
  and **never run under tests** (started from `main()` in `src/index.ts`, guarded
  on `VITEST`); tests drive sync via `runCalendarSync` or `POST /api/v1/m365/sync`.
  Store absolute UTC instants; keep the source timezone as display metadata only.
- **Tasks + To Do (Task 2.3).** Same provider-split as the calendar: the
  provider-agnostic `TaskProvider` / `MirroredTask` contract lives with the tasks
  module (`src/modules/tasks/providers/`); the Graph impl
  (`src/m365/task-provider.ts`) depends on it. To Do is **delegated-only** and
  **allowlist-gated per member** (`todo_list_allowlist`) — nothing syncs by
  default. Mirrored tasks are a sibling `task_mirror` table (feed key
  `todo:member:<id>:<listId>`); unlike the calendar it is **NOT read-only** —
  completion writes back (PATCH) and Heorth creates tasks outward into the shared
  list (`M365_SHARED_TODO_LIST`, resolved BY NAME via the allowlist store,
  preferring the acting member). The write paths run through a **provider seam**
  (`src/modules/tasks/provider.ts`, `setTaskProvider`) so the module never imports
  a Graph type; `m365Module.register` installs the Graph provider when enabled and
  tests install a fake-backed one. Provider write failures surface as a Graph-free
  classified `TaskProviderError` (`needs_reauth` / `no_connection` / `graph_<n>` /
  `shared_list_unavailable` / `provider_unavailable` / …). The per-feed sync
  machinery is shared: `src/m365/sync-runner.ts` (`syncOneFeed`, `classify`,
  `isFullResyncDue`) backs BOTH `calendar-sync.ts` and `task-sync.ts`. Task feeds
  join the scheduler tick + `POST /api/v1/m365/sync` (sequential after calendar).

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

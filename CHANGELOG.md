# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **`FEOH_ENABLED` kill switch removed — finance is now always on.**
  `feohModule` mounts unconditionally in `ALL_MODULES`
  (`src/modules/index.ts`); `/api/v1/feoh/*` and `feoh.*` MCP tools are
  always present, and the web UI no longer needs to gate its finance nav on
  `GET /api/v1/features`. **Behavior change** for any deployment relying on
  the switch to hide finance — it is no longer possible to disable the
  module via env var.

### Added

- **Satellite identity: asymmetric signing keys + a public JWKS**
  (task B1c, Wyrhta-Labs/wyrhta-labs#1). Heorth is becoming the household's
  identity provider for satellite services (KithLedger first), and the trust
  model is asymmetric keys — Heorth signs with a private key and publishes the
  public keys, so a satellite can only ever **verify** and is structurally
  unable to mint. A shared signing secret was explicitly rejected.
  - `GET /.well-known/jwks.json` publishes the public key set. It is
    **unauthenticated by design** (a satellite fetches it with no credentials),
    mounted outside `/api/v1` so no guard or catch-all applies, and is the one
    Heorth response that is **not** wrapped in the `ok()` envelope — a JWKS is
    a wire-format contract and generic clients expect a bare
    `{ "keys": [...] }`. It exposes public key material only.
  - New env group `SATELLITE_SIGNING_KEY` + `SATELLITE_SIGNING_KID`, optional
    **as a group** exactly like `M365_*` / `KITH_*`: absent (the default) →
    Heorth starts and behaves exactly as before and the endpoint returns
    `{"keys": []}`; partial presence is a startup error. `SATELLITE_SIGNING_ALG`
    selects `EdDSA` (Ed25519, the recommended default) or `RS256`. Material is
    a PKCS#8 PEM or JWK JSON, with `\n`-escaped PEMs accepted so a key fits in
    a single-line `.env`.
  - **Rotation** is supported through a second, publish-only slot
    (`SATELLITE_SIGNING_KEY_SECONDARY` / `_KID_SECONDARY` / `_ALG_SECONDARY`):
    published in the JWKS with its own `kid` but never used for signing, so a
    new key can be pre-published before it goes active and an outgoing key
    stays verifiable while it retires. It accepts **public** material, so
    retired private keys can be deleted from the host. The operator procedure
    is documented in README.md, "Rotating the satellite signing key".
  - **`JWT_SECRET` is untouched.** It still signs member logins and still
    derives the M365 refresh-token encryption key (`src/m365/crypto.ts`); it
    stays inside this service and the satellite key is entirely separate.
    Existing tokens keep working.
  - The token-exchange endpoint that will use these keys (`he_` key → a
    short-lived satellite JWT) is **task B3** and is deliberately not part of
    this change; ADR 0009 is still `proposed`.

- **Satellite token exchange: `POST /api/v1/auth/satellite-token`**
  (task B3, Wyrhta-Labs/wyrhta-labs#1, ADR 0009). The endpoint that turns a
  credential Heorth already accepts into member identity a satellite will
  believe. Authenticated by `requireAuth`, so an `he_` API key *or* a member
  JWT both work; heorth-mcp holds no signing key and stays structurally unable
  to mint.
  - Request `{ "audience": "kithledger" }`; response
    `{ "token", "expires_in": 300, "audience" }`. The token carries `sub` (the
    member id), `role`, `iss: heorth`, `aud: <satellite>`, `iat`, `exp`, and is
    signed with the **active satellite key** — a satellite verifies it against
    `/.well-known/jwks.json` by `kid`. **TTL is 5 minutes**, fixed.
  - **`sub`/`role` come from the authenticated principal, never the request
    body**, so the exchanged token grants no more than its bearer already had:
    a `child` caller gets a `child` token, and a body carrying someone else's
    `sub` is discarded.
  - **`JWT_SECRET` is never used here.** With no satellite key configured the
    endpoint answers `503 SATELLITE_SIGNING_UNAVAILABLE` rather than falling
    back to another key or 500-ing.
  - New env var `SATELLITE_AUDIENCES` — a comma-separated allowlist of the
    satellites Heorth will mint for (lowercase slugs). **Empty by default**, so
    the endpoint is inert until an operator names a satellite; an unregistered
    audience is `400 UNKNOWN_AUDIENCE`, never minted optimistically. Setting it
    without a signing key is a startup error.
  - Rate-limited per source IP in front of the auth guard, at 60 requests /
    15 min — the same middleware as `POST /auth/token` with a budget sized for
    a machine caller (heorth-mcp is one source IP for the whole household).
  - **Audited**: `auth.satellite_token.issued` on every mint and
    `auth.satellite_token.refused` on every refusal (member, audience,
    credential type, reason) — never any token or key material. This settles
    ADR 0009 open question 2: log everything, because a caching client only
    reaches Heorth on a cache miss, which bounds the volume at roughly one line
    per member per TTL.

- **`GET /api/v1/events` accepts `limit`/`offset` in the range view.** With
  `from`+`to` the endpoint expands recurrence and merges the read-only external
  mirror; `limit`/`offset` now bound those **expanded occurrences** (previously
  they were silently ignored whenever a range was given) while `meta.total`
  still reports the unbounded occurrence count. Together with the existing
  `member_id` filter this makes "the next N upcoming occurrences, optionally
  for one member" a single bounded REST query — the capability the
  `calendar.list_upcoming` MCP tool needs once MCP becomes a pure REST client
  (ADR 0008). `service.listUpcoming` is now implemented as exactly that query,
  so REST and MCP share one code path. Additive: omitting both parameters
  leaves the previous response unchanged.

- **Inventory module** (`src/modules/inventory/`) — a standalone, always-on
  `HeorthModule` for household items: name/category/manufacturer/model/
  serial/location/notes, purchase price/date, warranty, and a
  decommission/reactivation lifecycle. REST (`/api/v1/inventory`, with
  search/status/category filters and pagination) and four MCP tools
  (`inventory.list_items`/`get_item`/`record_item`/`decommission_item`,
  `src/modules/inventory/mcp.ts`). No dependency on feoh; the sole
  inventory→feoh touchpoint is a raw-SQL existence check against
  `feoh_item_costs` (`hasDisposalLink` in `service.ts`) that blocks
  reactivating an item with a recorded disposal link.
- **Recurring bill occurrences** (`src/modules/feoh/occurrences.ts`) — a
  bill's cadence projects into due-date entries with derived status
  (`planned`/`overdue`/`paid`/`skipped`/`unknown`); linking, skipping,
  unskipping, and overriding an occurrence persist a `recurring_occurrences`
  row only once it's touched, pruning back to pure projection when
  untouched again. Off-schedule (edited) rows always surface even past the
  listing's horizon.
- **Item cost links + total-cost-of-ownership** (`src/modules/feoh/
  item-costs.ts`) — links a transaction to an inventory item as a cost
  (purchase/disposal/repair/maintenance/accessory) and rolls up a per-item
  TCO breakdown (capital + tier2 + recurring − proceeds, plus a per-year
  rate over the item's lifetime).
- **Account ledger + Kassensturz reconciliation** (`src/modules/feoh/
  ledger.ts`) — a per-account running-balance ledger (Postgres window
  function over the full unfiltered history, so paginated balances stay
  correct) and a reconciliation flow that books an adjusting transaction
  between a physically counted balance and the ledger balance through a
  given date (asset accounts only, guarded against later postings that
  would silently shift).
- **German locale coverage** for the new inventory, occurrences, and ledger/
  Kassensturz UI surfaces.
- Migration `0015` for the inventory + occurrences + item-cost tables.

### Fixed

- Recurring-occurrence override race: a concurrent insert on the same
  (billId, dueDate) now maps the underlying `23505` conflict to a
  classified error, matching the existing link/skip behavior, instead of
  leaking a raw 500.
- `inventory.list_items` MCP tool now accepts `limit`/`offset`, matching the
  REST endpoint's pagination.
- Inventory search escapes `%`/`_` in the ILIKE pattern so a literal wildcard
  character in a search term (e.g. `100%`) no longer wildcard-matches
  unrelated items.
- Kassensturz reconciliation now also invalidates the month-summary query on
  the web client, since a booked difference posts to an envelope.
- `item-costs.ts` and `ledger.ts` now derive "today" from the same shared
  `localTodayIso()` helper (`src/modules/feoh/dates.ts`) instead of two
  independent implementations (one of which used UTC and could misclassify
  dates around local midnight).

## [0.5.0] - 2026-08-11

### Added

- **Feoh merged back as a built-in optional feature** (ADR 0007, meta repo
  `docs/plans/feoh-merge.md`) — the finance satellite (its own repo, database,
  and container, reached through an HTTP proxy) is retired; finance is now a
  `HeorthModule` living in-process at `src/modules/feoh/`, mounted like any
  other module.
  - **`FEOH_ENABLED` kill switch** (`src/config/env.ts`, default off): unset,
    empty, or `false` leaves the module a no-op — `/api/v1/feoh/*` falls
    through to the `/api` catch-all 404 and no `feoh.*` MCP tools register.
    `true` mounts the routes and tools. Toggling it never touches data.
  - **`GET /api/v1/features`** — a small, authenticated (any role) capability
    endpoint the web UI fetches once after login to decide whether to render
    the finance nav/pages (`{ finance: boolean }`), replacing any
    satellite-reachability probe.
  - **Finance tables, fresh start.** Envelopes, accounts, double-entry
    transactions, and recurring bills land via a fresh migration
    (`0013_feoh_merge.sql`) with `memberId` foreign keys pointing directly at
    Heorth's own `members` table — no `partyId` indirection, no roster mirror.
    The satellite's database is **not migrated**; this is a clean slate, not a
    data migration.
  - **Guards moved from the proxy into the module.** The write-role guard
    (`admin`/`adult`, children excluded) and the maintenance-admin write
    rejection now live directly in `src/modules/feoh/routes.ts` and
    `src/modules/feoh/mcp.ts` instead of being layered onto a forwarding proxy.
  - **MCP tools register exactly once.** `collectMcpTools` (the ad hoc
    dedup/registration helper) is gone from `src`; `createApp(modules, mcp?)`
    now takes the MCP registry as an explicit second argument, and every
    module (including `feoh`) registers its tools through the same path a
    single time.
  - **Web gating.** The finance nav entry (desktop sidebar and mobile nav) and
    the finance page are gated on `GET /api/v1/features` via a shared
    `useFinanceEnabled` hook, so a disabled backend hides the feature in the
    UI rather than leaving a nav item that 404s.
  - `src/satellites/`, the satellite HTTP client/proxy/roster, and the
    `FEOH_BASE_URL` / `FEOH_API_KEY` env vars are removed entirely.

## [0.4.0] - 2026-07-29

### Changed

- **PostgreSQL 16 → 18** — **breaking for existing deployments.** Postgres is
  now pinned to 18 everywhere it is configured: the Compose `db` service, the
  staging CI service container, and the local `kith-testdb` bootstrap in the
  `run-local` skill. Two migration steps are required and neither is automatic:
  - The Compose volume moves from `/var/lib/postgresql/data` to
    `/var/lib/postgresql`. This is not cosmetic — the `postgres:18` image
    relocated its default `PGDATA` to `/var/lib/postgresql/<major>/docker`, so a
    volume left on the old path no longer covers the data directory and the
    container initialises into its own image layer, silently failing to persist.
  - An existing `postgres_data` volume was written by 16 and **cannot be read by
    18**. `pg_dump` (or `pg_dumpall`) under 16, then restore into a fresh volume
    under 18. Verified locally on 18.4 by dump/restore of a 16.13 cluster: 8
    databases, 82 tables, 271 rows, byte-identical row counts, full backend and
    web suites green afterwards.

  Historical records (earlier changelog entries, `docs/superpowers/` plans and
  specs, `.superpowers/sdd/` task briefs) deliberately keep their `16`
  references — they document what was built at the time.

### Added

- **Container images published to GHCR** — new
  `.github/workflows/build-image.yml`, mirroring KithLedger's workflow so both
  services behave identically. Images go to `ghcr.io/wyrhta-labs/heorth`:
  `:staging` (moving) plus an immutable `:staging-<sha>` for staging pushes,
  and semver (`X.Y.Z`, `X.Y`, `X`) plus `latest` only from `v*` tag pushes —
  branch builds never receive a production tag. Builds run on every branch
  except `main` plus version tags, use the `gha` build cache, and honour
  `[skip ci]` / `[no build]` commit-message markers. A lightweight
  typecheck-and-web-build job gives fast feedback on branches that
  `staging.yml` does not cover.

### Fixed

- **The container image could not be built at all.** The single-stage
  `Dockerfile` installed only root dependencies and then ran `build:web`
  (`cd web && npm run build`), but this repo is not an npm workspace, so
  `web/node_modules` never existed and the web build failed on a missing
  `@vitejs/plugin-react`. The documented `npm run docker:up` path was therefore
  broken too. Replaced with the same three-stage build KithLedger uses — web
  builder, backend builder, production-only runner — which also drops
  devDependencies and source from the published image (351 MB). Two runtime
  inputs a multi-stage build does not pick up incidentally are now copied
  explicitly: the drizzle migration SQL and snapshot metadata (`bootstrap()`
  migrates from `./src/db/migrations` at boot) and `web/dist` (`createApp()`
  serves it for every non-`/api` route). Verified by running the image against
  a throwaway database: 13 migrations applied, 15 tables created, household and
  admin seeded, a JWT from `POST /api/v1/auth/token` authenticating
  `GET /api/v1/household`, the SPA and its hashed assets served, and the `/api`
  404 envelope and `/health` intact.

## [0.3.1] - 2026-07-28

### Added

- **Web localisation, German first** (#4): the household `locale` setting was
  stored but nothing consumed it — the whole UI (including the wall display's
  day/date strings) was hardcoded English. The web app now speaks the household
  language end to end: react-i18next with `en` + `de` message catalogues
  (informal du), typed `t()` keys, and a parity test guarding key sets and
  `{{placeholder}}` drift between languages; a locale map resolving every
  supported locale to its catalogue language and closest date-fns locale;
  `I18nProvider` driving both from `household.locale`; and a `useFormatters`
  hook for locale-aware date/number formatting. Translated surface: Hearth
  View first, then the phone screens (today, shopping, capture), the main app
  pages, settings, layout chrome, PWA banners, option labels, and user-facing
  error display, with proper i18next plurals for count strings.

### Changed

- **Household settings — timezone and locale are pick-from-list** (#2): both were
  free text, and since `household.timezone` drives To Do/calendar date semantics
  a typo silently landed completions and due dates on the wrong local day. The
  settings page now renders a `<select>` of IANA zones (grouped by region, `UTC`
  first) and one of the supported locales, both populated from a new
  `GET /api/v1/household/options`; `PATCH /api/v1/household` rejects anything off
  those lists (`Unsupported timezone` / `Unsupported locale`). The allowed sets
  live in one place (`src/household/options.ts`) and are served to the client so
  they cannot drift. A stored value absent from the list (a row predating
  validation) stays visible and selected rather than being silently replaced by
  the first option, and a rejected save now surfaces an error toast instead of
  reporting success.
- Bumped `@wyrhta/core` to v0.1.3.

### Fixed

- **Hearth View — tasks due-window 400s** (#3): `/hearth` polled
  `GET /api/v1/tasks` with date-only `due_from`/`due_to` values, which the
  validator (full ISO datetime) rejected — every poll 400'd and the footer
  stuck on "Reconnecting…". The page now sends full ISO instants for the
  window bounds.
- **Calendar mirror — recurring series** (first live-tenant run, 2026-07-25):
  `calendarView/delta` delivers recurring series as a `seriesMaster` item (at
  its original, possibly decades-old start — birthdays surfaced as 1932 events)
  plus **sparse occurrences** carrying only `id`/`type`/`seriesMasterId`/
  `start`/`end` (no subject, no `isAllDay`) — undocumented but
  Microsoft-confirmed behavior that contradicts the v1.0 reference. The Graph
  provider now never mirrors masters as events (their ids purge any previously
  mirrored master rows — self-healing, by externalId only), enriches
  occurrences/exceptions from the master (same-pull map first, else one cached
  `GET /events/{seriesMasterId}`; 404 ⇒ the orphan occurrence is skipped), and
  records `series_master_id` on mirrored rows so a genuine `@removed` master
  tombstone cascades to its occurrences. A one-time migration forces the next
  calendar sync of every feed to a full re-window so pre-fix rows heal at
  deploy rather than at the weekly resync.
- **To Do — date-only Graph values** (first live-tenant run, 2026-07-25):
  `dueDateTime`/`completedDateTime` are calendar **dates**, not instants (the
  service truncates to midnight in the authoring zone and returns the UTC
  equivalent; completing via bare `status` PATCH stamps midnight of the **UTC**
  date — a Microsoft-acknowledged known issue). They were stored as raw UTC
  instants, so a completion at 00:45 CEST landed on the previous local day and
  due dates would shift a day early in negative-offset zones. The provider now
  resolves the intended calendar date in the **household timezone** (new
  dependency-free `Intl` helpers + `getHouseholdTimeZone()` with UTC fallback)
  and stores household-local-midnight instants; completion write-back sends an
  explicit `completedDateTime` (local date + IANA zone) alongside `status`, and
  outward task creation sends the due date the same way instead of a UTC
  instant.
- **M365 smoke script**: the app-only probe read `GET /users/{mailbox}` which
  needs `User.Read.All` — a permission the app deliberately lacks — so it
  failed even when correctly configured. It now probes the family mailbox's
  `calendarView`, the `Calendars.Read` application permission production
  actually uses.

## [0.3.0] - 2026-07-24

### Added

- **Hearth View — always-on kitchen wall** (Phase 2 Task 2.5): `/hearth`, a
  full-bleed kiosk surface for a 1920×1080 touchscreen, rendered outside the app
  chrome. Composes the calendar mirror (2.2), To Do tasks (2.3), and the meal
  plan into a calm noticeboard: a **week view** of seven day columns (events +
  planned supper + due tasks), a **now/next strip** for today, and a one-tap
  **month view**, with paging between weeks/months. Member events carry their
  avatar colour; **family-calendar events render as the household's shared amber
  band** (distinct from every member colour — the delegated family-feed colour
  policy). Glance-and-tap interactions only: tap a task to complete it
  (write-through to To Do, with a gentle "couldn't reach Microsoft" toast on the
  502/503 transient path — never a stack trace), tap a meal for a **large-type
  recipe reading overlay**, and **drag a supper between days** (the single edit
  gesture; persists via the meal-plan API). Completed tasks strike through and
  reset at midnight, capped at three per day with a "+N done" collapse.
  Auto-refresh via TanStack Query polling (tasks ~30s, events ~60s, meals ~120s)
  with refetch-on-reconnect and a stale-while-revalidate "as of HH:MM" stamp so
  Wi-Fi blips never blank the wall; **per-feed staleness** from
  `GET /api/v1/m365/status` — **household-visible to any authenticated
  session** (no secrets in the `feeds[]` payload), so a dead feed on any
  member's connection is visible on the shared wall, not just to that member —
  greys the affected items and points recovery at the phone ("reconnect from
  your phone"); no auth flow ever runs on the wall. As an unattended kiosk,
  `/hearth` also suppresses the PWA update-banner prompt entirely and instead
  silently applies a waiting service-worker update the next time the wall goes
  idle, so nobody has to tap "Reload" on a screen no one is minding.
  Screen-burn-friendly always-on treatment: a slow CSS drift of the whole
  surface (off under `prefers-reduced-motion`) and an idle dim, plus a capped
  query `gcTime` so an all-day session's cache stays bounded. Both the Hearth
  week/month grid and the calendar-grid day bucketing use the household's
  **local calendar day** (not a UTC-sliced instant) for completion resets and
  day-column placement, so the boundary lands at local midnight rather than
  01:00–02:00 local in UTC+1/+2. Pure composition logic
  (`web/src/lib/hearth.ts`) is unit-tested independently of the React layer.
  The wall uses the app's normal login (JWT TTL `JWT_TTL_SECONDS`, default 7
  days → re-login weekly; raise the env var on a trusted device) — no
  device-token machinery this phase, by explicit decision.

- **Installable phone PWA** (Phase 2 Task 2.4): the web app now installs to
  an iOS/Android homescreen (`web/public/manifest.webmanifest`, apple-touch
  and maskable icon set generated from the brand palette — `web/scripts/
  generate-icons.mjs`) and works offline for its one critical mobile surface.
  A hand-rolled service worker (`web/public/sw.js`, no Workbox/vite-plugin-pwa
  — small and easy to reason about at this scale) caches the build shell
  cache-first and lets `/api/*` calls through network-first; a new deploy's
  worker waits until the user taps "Reload" on an in-app update banner
  (`src/components/pwa/update-banner.tsx`), never yanking the page out from
  under someone mid-session. The **shopping list** renders its last-known
  state with an "offline · data from …" indicator when the network is down,
  and check-offs made offline are queued (`src/lib/shopping-offline.ts`) and
  replayed once connectivity returns — safe to replay because the check-off
  endpoint is an absolute `{checked}` set, not a toggle. Three phone-first
  screens: **Shopping list** (`/shopping`, one-handed, big touch targets),
  **Today** (`/today`, compact agenda + tonight's supper + due tasks), and
  **Quick capture** (`/capture`, add a task to the shared list or a free-text
  meal note in two taps). A bottom tab bar (`src/components/layout/
  mobile-nav.tsx`) surfaces these on phone widths; the sidebar/desktop layout
  is unchanged above the `md` breakpoint. No push notifications — quiet by
  design.

- **Household Tasks + Microsoft To Do sync** (Phase 2 Task 2.3): the household
  task surface, backed by Microsoft To Do as the system of record. A
  provider-agnostic `TaskProvider` / `MirroredTask` contract
  (`src/modules/tasks/providers/`) with a Graph implementation
  (`src/m365/task-provider.ts`) — **delegated-only** (every feed runs on a
  member connection). To Do is **allowlist-gated per member**: nothing syncs
  until a member selects lists (`GET/PUT /api/v1/tasks/allowlist`,
  `GET /api/v1/tasks/lists` for discovery). Allowlisted lists sync via
  `/me/todo/lists/{listId}/tasks/delta` into a sibling `task_mirror` table
  (migration `0010_tasks_mirror`); feed key `todo:member:<id>:<listId>`. Unlike
  the calendar, tasks are **interactive**: `POST /api/v1/tasks/:id/complete`
  writes completion back (PATCH) with an optimistic local update, and
  `POST /api/v1/tasks` creates a task into the **shared household list**
  (`M365_SHARED_TODO_LIST`, resolved BY NAME through a connected member who has
  it — the acting member if possible, else any member that does). `GET
  /api/v1/tasks` lists the mirror with filters (status / member / list / due
  range). All members may read; any authenticated member (children included) may
  complete/create; a write against a dead/absent connection returns a
  **classified** error — 409 for a member-actionable state (needs re-consent, or
  the shared/requested list is unavailable), **502/503 for a transient Graph
  5xx or network failure** (mirroring the Feoh/Library precedent, not
  flattened into a generic 500), 500 for everything else — never a crash and
  never a silent drop. MCP
  tools `tasks.list` / `tasks.complete` / `tasks.create`. Task feeds join the
  existing M365 scheduler tick and `POST /api/v1/m365/sync` (sequential after
  calendar, same per-feed isolation), and appear in `GET /api/v1/m365/status`.
  The per-feed sync machinery (connection short-circuit, periodic full re-sync,
  error classification, isolation) was extracted to a shared `src/m365/sync-runner.ts`
  used by both the calendar and To Do runners. A modest web Tasks page (grouped
  open tasks, check-off, quick-add, per-member list toggles) ships alongside.
  `tests/fake-graph.ts` gains scriptable To Do list/delta/PATCH/POST doubles.
  Zero impact when the integration is disabled (mirror empty; writes return
  `PROVIDER_UNAVAILABLE`).
- **Microsoft 365 read-only calendar mirror** (Phase 2 Task 2.2): a
  provider-agnostic `CalendarProvider` / `MirroredEvent` contract
  (`src/modules/calendar/providers/`) with a Graph implementation
  (`src/m365/calendar-provider.ts`) over the Task 2.1 foundation — per-member
  **default calendar** (delegated) and the **family mailbox** (app-only) pulled
  via `calendarView/delta` on a rolling window (−60d … +400d). A delta token
  replays the same window it was minted with, so each feed also forces a
  deterministic **full re-window** every `M365_FULL_RESYNC_INTERVAL_SECONDS`
  (default 7 days, independent of the poll cadence), tracked via
  `m365_sync_state.last_full_sync_at` — this is what actually rolls the
  −60d/+400d window forward over time, rather than leaving it pinned to
  wherever it was when the token was first minted. Recurring events
  are mirrored as Graph's expanded occurrences. Mirrored events live in a
  sibling `calendar_mirror_events` table (migration `0008_calendar_mirror`) and
  merge into the existing calendar range/week/dashboard/MCP queries, but are
  **read-only everywhere** — REST + MCP mutations of a mirrored event are
  rejected (`EVENT_READ_ONLY`) and the web shows them with a source marker and no
  edit affordance. A background scheduler (`M365_SYNC_INTERVAL_SECONDS`, default
  300, floored at 60; optional, independent of the all-or-nothing group) polls
  all feeds, isolating and recording per-feed errors in `m365_sync_state`
  (short classified strings only); `410 Gone` triggers a full feed re-sync and
  `needs_reauth` connections are skipped, not hot-retried. New `POST
  /api/v1/m365/sync` (admin) drives a sync on demand and `GET /api/v1/m365/status`
  now returns per-feed sync state (delta token never exposed). Absolute UTC
  instants are stored; the source timezone is kept as display metadata only. The
  scheduler never runs under tests; `tests/fake-graph.ts` gains a scriptable
  `calendarView/delta` double. Zero impact when the integration is disabled.
- **Microsoft 365 foundation** (`src/m365/`, Phase 2 Task 2.1): env wiring for
  the `M365_*` group (optional as a group — all present or none; partial is a
  startup error), delegated (auth-code) + app-only (client-credentials) Graph
  auth clients with in-memory access-token caching and refresh-token rotation, a
  `graphFetch` helper (bearer + 429 retry + typed `GraphError`), refresh tokens
  encrypted at rest (AES-256-GCM, `src/m365/crypto.ts`), and the connection
  routes `GET /api/v1/m365/connect|callback|status` + `DELETE .../connection`.
  New tables `m365_connections` (per-member delegated connection) and
  `m365_sync_state` (generic per-feed sync state for Tasks 2.2/2.3), migration
  `0007_m365_foundation`. Disabled by default with **zero impact**: no routes
  mount and `/api/v1/m365/*` returns the catch-all 404 when the env is absent.
  Fake Graph test double (`tests/fake-graph.ts`) + manual smoke
  (`scripts/m365-smoke.ts`). No Graph type or URL leaks outside `src/m365/`.
- `.env` auto-load for local dev (`src/config/env.ts`): loaded from the working
  directory, never overriding exported variables. Test setup refuses to run
  against a `_dev` database. `.dockerignore` added so `.env` can never be baked
  into images. `.env.example` gains the canonical `M365_*` variable names for
  the Phase 2 integration (placeholders only).
- `README.md` (new) — quick start, API surface overview, Feoh satellite
  proxy summary, and the testing gotcha (export `DATABASE_URL` manually).

### Changed

- Dev port moved to **4000** (`.env.example`, docker-compose host mapping,
  Vite proxy, README) and `FEOH_BASE_URL` dev default to `http://localhost:4001`,
  per the cross-service dev port allocation (Heorth 4000/5173, Feoh 4001,
  KithLedger 4002/5174). Container-internal port stays 3000.
- **Roster mapping misses are now classified, not a generic 500.** If a
  member is still unmapped to a Feoh party after a *successful* re-sync, the
  finance proxy now returns `500 ROSTER_MAPPING_MISSING` with the member id
  logged, instead of letting the error escape unclassified. (Distinct from
  the existing `503 SERVICE_UNAVAILABLE` used when Feoh itself is
  unreachable.)
- **Concurrent roster-sync misses now share one in-flight sync** —
  `FeohRoster.sync()` dedups overlapping calls instead of each cache miss
  triggering its own full upsert round.
- **Member `displayName` changes now best-effort re-upsert the Feoh party**
  immediately (`household/service.ts#updateMember`), rather than waiting for
  the next boot sync or lazy re-sync to pick it up. A re-upsert failure
  never fails the profile update itself.

### Fixed

- **Calendar mirror feeds now actually roll their window forward.** A Graph
  `calendarView/delta` token replays the same `startDateTime`/`endDateTime` it
  was minted with, so the −60d/+400d mirror window was staying pinned to
  whenever the token was first issued instead of advancing; feeds now force a
  full re-window every `M365_FULL_RESYNC_INTERVAL_SECONDS` (default 7 days)
  even while the delta token is still valid.
- **Task write-back no longer flattens transient failures to a generic 500.**
  `POST /api/v1/tasks/:id/complete` and `POST /api/v1/tasks` now map a Graph
  5xx to 502 and a network failure to 503, matching the Feoh/Library
  precedent; non-transient classified errors (409, or 500 for the integration
  being off) are unchanged.
- **Hearth View and calendar-grid day bucketing use local calendar days, not
  UTC-sliced instants.** Completed-today resets, day-column placement (week
  and month views), and the calendar grid were rolling over at 01:00–02:00
  local time in UTC+1/+2 instead of local midnight.
- **Hearth View drag-and-drop tears down cleanly on `pointercancel`** (touch
  scroll takeover / palm rejection) instead of leaving a stale in-progress drag
  state, and clears any in-flight drag's listeners on unmount.
- **The Hearth wall no longer shows the PWA "Reload" update banner** (nobody
  taps it on an unattended kiosk) — a waiting service-worker update is applied
  silently the next time the wall goes idle instead.
- **Per-feed M365 staleness is now household-visible, not member-scoped.** A
  non-admin kiosk session on `/hearth` previously only saw its own member's
  feed staleness from `GET /api/v1/m365/status`, so another member's dead feed
  could look current on the shared wall; `feeds[]` is now visible to any
  authenticated session (no secrets in it), while `connection`/`connections`
  stay member/admin-scoped as before.

## [0.2.0] - 2026-07-24

### Added

- **Library module** — media/book library tracking, with connectors for
  [Trakt](https://trakt.tv/) (OAuth device-flow, merged sync) and
  [LibraryThing](https://www.librarything.com/) (endpoint + export parsing);
  AES-256-GCM credential encryption for stored connector tokens; idempotent
  item sync; REST routes and MCP tools; web page with a connect flow and
  shelf view.

### Changed

- **Feoh finance is now an independent satellite service**, not an in-process
  Heorth module. Heorth mounts a transparent proxy (`src/satellites/feoh/`) at
  the same `/api/v1/feoh/*` paths, forwarding requests to the standalone Feoh
  service (its own repo and database) authenticated with one service API key.
  A best-effort roster sync mirrors household members into Feoh's `parties`
  boundary (`memberId` ↔ `partyId`); an unreachable Feoh maps to `503`, and
  Feoh's own `4xx` responses pass through unchanged.
  - New required env vars: `FEOH_BASE_URL`, `FEOH_API_KEY`.
- `@wyrhta/core` bumped to `v0.1.2`.

### Removed

- The in-process `feoh` module (`src/modules/feoh/`) and its database tables
  (`accounts`, `envelopes`, `transactions`, `postings`, `recurring_bills`,
  `expense_splits`) — dropped via migration `0006_drop_feoh_tables.sql`
  (greenfield: no deployed data carried over).
- Heorth's own MCP server no longer exposes `feoh.*` tools — they now live on
  the Feoh service's own `/mcp` endpoint.

## [0.1.0] - 2026-07-13

Initial release. Retroactively tagged — see the release notes below.

### Added

- **Household foundation** — household singleton seeded at first boot;
  members as core-identity users with role (`admin`/`adult`/`child`) and
  profile (display name, avatar color); first-boot admin seed, per-member
  JWT login, `he_` API keys; REST `/household`, `/members`; MCP
  `household.get_members`, `household.whoami`.
- **Calendar module** — `events` + `event_attendees` schema with server-side
  ISO-8601 recurrence expansion; REST CRUD on `/events` with range/week-view
  query; MCP `calendar.{list_events,create_event,update_event,move_event,list_upcoming}`;
  `child` role limited to modifying events it created.
- **Meals module** — `recipes`, `meal_plan_entries`, `shopping_list_items`
  schema; `/recipes` CRUD, `/meals/plan` get/upsert, shopping-list generation
  (merges like items) with check-off/add/remove; MCP
  `meals.{list_recipes,create_recipe,plan_meal,get_week_plan,generate_shopping_list,check_off_item}`.
- **Feoh finance module** (in-process at this release) — double-entry
  `accounts`, `envelopes`, `transactions`/`postings`, `recurring_bills`, and
  `expense_splits`; atomic balanced-posting transactions; month summary
  (spend per envelope vs. budget); CSV import/export and plaintext ledger
  export; MCP
  `feoh.{list_envelopes,record_transaction,get_month_summary,list_recurring_bills,import_csv,export_ledger}`;
  writes gated to `admin`/`adult` roles.
- **MCP server** — one server per instance, assembled in `src/mcp/` from
  every module's registry via `@wyrhta/core`'s scaffold; `he_` key resolves
  to a member + role with the same role checks and audit logging as REST.
- **REST API** over all of the above, with a shared response envelope,
  pagination, request-id/security-headers/rate-limit/error-handler
  middleware, and structured logging via `@wyrhta/core`.
- **React web UI** (`web/`) — auth flow, app shell and routing, dashboard,
  Calendar, Meals, Feoh, and household/member-management pages.
- **Docker** — API + PostgreSQL 16 Compose stack; staging CI (build + test).

Full acceptance mapping: `docs/superpowers/heorth-0.1-acceptance.md`.

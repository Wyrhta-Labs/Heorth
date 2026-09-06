# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Bank import (ADR 0016)** — Firefly III as an optional one-way ingestion
  sidecar (`src/modules/feoh/import/`). Four new tables (`feoh_import_accounts`,
  `feoh_import_rules`, `feoh_imported_transactions`, `feoh_import_state`,
  migration `0028`); none of the existing Feoh tables changes. A scheduler tick
  pulls pages through a two-method `TransactionSourceProvider`, dedups on
  `source_id`, books rule hits through `recordTransaction()` attributed to the
  rule's author, and parks the rest in an inbox. New routes under
  `/api/v1/feoh/ingestion/*`: `status`, `sync`, `accounts` (source → Feoh
  account map), `rules`, `inbox` (+ `confirm`, `dismiss`, and a manual line
  `POST`). Env: `FEOH_IMPORT_ENABLED`, `FIREFLY_BASE_URL`, `FIREFLY_PAT`,
  `FEOH_CURRENCY` (default `EUR`). Off by default; the inbox and rules work
  without Firefly.
- **Feoh page: "Bank import" card** — inbox with book/dismiss, import rules,
  and the source-account mapping, in English and German.

### Changed

- **Deleting a booked transaction returns its bank line to the inbox** instead
  of erasing the record that the line existed (ADR 0016 consequence).
- `DELETE /api/v1/feoh/envelopes/:id` answers `409 ENVELOPE_IN_USE` when an
  import rule still points at the envelope (was a raw 500 on the FK restrict).

### Known gaps

- A member who authored an import rule cannot be hard-deleted while it exists
  (`onDelete: restrict`, the same class of key as `transactions.created_by`).
  The member-delete path does not yet explain which rows block it; that is
  true of the existing finance keys too and is deferred together with them.
- Firefly transfers between the household's own accounts are skipped; only
  withdrawals and deposits become inbox lines.

## [0.7.0] - 2026-09-05

### Added

- **Google provider: Calendar mirror + Tasks with write-back**, running
  alongside Microsoft 365 rather than replacing it (`src/google/`). Optional
  as a group behind three variables (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
  `GOOGLE_REDIRECT_URI`); M365 and Google can each be enabled independently.
  Google Calendar mirrors read-only into the same `calendar_mirror_events`
  table M365 uses, on the same delta-plus-periodic-full-rewindow pattern
  (`GOOGLE_FULL_RESYNC_INTERVAL_SECONDS` beside `M365_FULL_RESYNC_INTERVAL_SECONDS`).
  Google Tasks syncs into `task_mirror` with completion write-back and
  household task creation, the same as M365 To Do — except Tasks always pulls
  a full snapshot rather than a delta, reconciling the mirror against it on
  every pull. Unlike the M365 providers, the Google providers resolve a feed
  from its allowlist row rather than parsing the feed key, because a Google
  calendar id is email-shaped.
- **`calendar_allowlist` table (migration `0027`)**: per-member, per-provider
  calendar discovery and selection, the calendar-side sibling of
  `todo_list_allowlist`, including an `is_household` flag for designating one
  member's calendar as the shared family calendar. New routes on a
  **separate** router at `/api/v1/calendar` (not `/api/v1/events`, which
  `calendarRouter` already occupies): `GET /api/v1/calendar/calendars`,
  `PUT /api/v1/calendar/allowlist`, `PUT /api/v1/calendar/household-calendar`.
- **The Google family calendar is designated, not app-only.** There is no
  Google equivalent of `M365_FAMILY_MAILBOX` / app-only client credentials —
  the shared family calendar is one member's own delegated Google calendar,
  flagged via `calendar_allowlist.is_household`. It stops mirroring when that
  member disconnects; `GET /api/v1/integrations/status`'s new
  `householdCalendar.connectionOk` reports that.
- **`.env.example` gains the `GOOGLE_*` group** (`GOOGLE_CLIENT_ID`,
  `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, plus the non-credential
  `GOOGLE_FULL_RESYNC_INTERVAL_SECONDS` knob), in the same all-or-nothing
  shape as `M365_*`.
- **Weorc module** (`src/modules/weorc/`, ADR 0014): household routines backed
  by `weorc_routines` and `weorc_occurrences`, with due-work materialisation,
  completion/skip history, an ungated background scheduler, and task projection
  through the existing Tasks provider when one is available. The Tasks service
  now exposes the projected-task create/complete and feed-reference lookup paths
  Weorc needs without making M365 a requirement.
- **Heorth can open KithLedger from its navigation.** `GET /api/v1/features`
  now returns `kithledgerUrl` when the KithLedger integration is configured,
  and the web shell renders it as an external `KithLedger` launcher. Deployments
  with internal service URLs can set `KITH_PUBLIC_URL`; otherwise it falls back
  to `KITH_BASE_URL`.

### Changed — BREAKING

- **`/api/v1/m365/*` is retired in favour of `/api/v1/integrations/*`**, which
  adds a provider segment to the connection routes (e.g.
  `/api/v1/integrations/m365/connect`, `.../m365/callback`). This is groundwork
  for the Google provider (see "Added" above) sitting beside M365 rather than
  replacing it. **Operator action required:** update the Entra app
  registration's redirect URI to `<base>/api/v1/integrations/m365/callback` —
  a registration still pointing at the old path fails consent with
  `redirect_uri_mismatch`.
- **`M365_SHARED_TODO_LIST` is gone.** The household task list — where
  household-created tasks land and what Weorc projects into — is now
  designated in the database (`todo_list_allowlist.is_household`) via
  `PUT /api/v1/tasks/household-list`, not by matching a list's name. **No list
  is designated automatically** — every way of inferring one from the old env
  value was unsafe — so household task creation and Weorc's projection pass
  both stay paused until an adult designates a list once after upgrading. A
  boot-time warning and
  `GET /api/v1/integrations/status`'s new `householdListDesignated` field make
  that state visible instead of a silent stop.
- **`M365_SYNC_INTERVAL_SECONDS` is renamed to
  `INTEGRATIONS_SYNC_INTERVAL_SECONDS`.** An un-renamed value in a hand-edited
  `.env` is silently ignored and the mirror poll falls back to its 300s
  default — check yours if you had tuned this. (The `deploy/` compose files
  never set it, so a bare-metal or standalone-Heorth deployment with a custom
  `.env` is the only one affected.)
- **`PUT /api/v1/tasks/allowlist` now takes a provider-tagged body:
  `{ "lists": [{ "provider": "m365" | "google", "listId": "<id>" }] }`.**
  `lists` is now REQUIRED — omitting it is a 400 `VALIDATION_ERROR`, and an
  explicit `[]` de-selects every list across every reachable provider. There
  is no `listIds` alias for the old single-provider array shape. **Operator
  action required:** any client calling this endpoint (including the web
  build shipped with this release) must send the new shape.
- **`GET /api/v1/integrations/status` replaces `connection` with
  `myConnections`** (the acting member's own connections, one per provider,
  provider-tagged) and adds `householdCalendar` (the designated family
  calendar's health, or `null`). Any caller reading the old singular
  `connection` field must be updated to read `myConnections` instead.

### Fixed

- **The maintenance-admin repair now covers every provider the admin has
  ever connected, not just currently-registered ones.** It clears stale feed
  state (connections, sync state, and calendar-mirror rows attributed to the
  admin, including household-designated rows with a null `memberId`) for the
  UNION of registered providers and providers the admin has historically
  connected to — registration is env-gated, but the repair runs at every
  boot, so a provider disabled after use would otherwise leave orphaned rows
  behind.
- **`.env.example` no longer contradicts the changes recorded above it in
  this same file.** It still had the retired `/api/v1/m365/callback` path in
  `M365_REDIRECT_URI` (fails consent with `redirect_uri_mismatch` if copied),
  the removed `M365_SHARED_TODO_LIST` variable (silently does nothing), and
  the old `M365_SYNC_INTERVAL_SECONDS` name (silently ignored in favour of the
  300s default) — three pre-existing leftovers from the `/api/v1/m365/*`
  retirement above, not something this branch introduced, corrected in
  passing while adding the `GOOGLE_*` group (see "Added") below it.
- **`writeError` in the Tasks routes now maps `google_5xx` to 502, matching
  the existing `graph_5xx` handling**, so an upstream 5xx from Google is
  reported the same way as the identical Microsoft failure instead of falling
  through to a generic 500.

- **De-selecting the designated household calendar or task list is now refused
  instead of silently honored.** `PUT /api/v1/calendar/allowlist` and
  `PUT /api/v1/tasks/allowlist` are open to any member for their own
  calendars/lists, but only an admin/adult can *designate* the household one —
  so un-designating it by simply omitting it from a de-selection used to
  require no special role and returned 200. Both routes now reject with 409
  (`HOUSEHOLD_CALENDAR_IN_USE` / `household_list_in_use`) when the submitted
  selection would drop the row carrying `is_household`. The tasks half is a
  pre-existing gap (Phase 1), not introduced by this branch — it broke
  `createHouseholdTask` and Weorc's projected maintenance tasks.

- **A full resync no longer deletes and re-inserts a feed's mirror rows.**
  `task_mirror.id` and `calendar_mirror_events.id` now stay stable across a
  `410`/periodic full resync — rows are reconciled (upserted where present,
  deleted where absent) instead of the whole feed being wiped and rebuilt. This
  removes an intermittent 404 where the web had a task's id in hand, a resync
  landed between the read and the write, and `POST /api/v1/tasks/:id/complete`
  hit an id that no longer existed.

## [0.6.0] - 2026-08-25

### Fixed

- **A bad `events.recurrence` no longer takes down the calendar range view.**
  `recurrence` is an ISO 8601 duration (`P1W`), but `createEventSchema` accepted
  any string — so an RRULE (`FREQ=WEEKLY;BYDAY=TU`), the shape most people reach
  for by habit, was stored happily. `GET /api/v1/events?from&to` expands every
  event in the window, so that one row made the range view return **500 for the
  whole household, on every request, permanently** — a write-time typo whose
  cost landed on all readers until someone found and deleted the row.

  Fixed at both ends. `createEventSchema`/`updateEventSchema` now reject an
  unusable recurrence with a 400 naming the field, and `expandEvent` degrades an
  unusable one to "not recurring" instead of throwing, so rows written before
  the validator existed cost a lost expansion rather than an outage.

  Also closes a second case the old regex allowed: `P`, `PT`, `P0D` and `PT0S`
  all parsed but advanced the cursor by nothing, looping to the expander's 2000
  iteration guard and emitting duplicate occurrences. Validation now requires a
  duration that actually advances. `src/lib/duration.ts` grows
  `parseDuration`/`isPositiveDuration` for this; `addDuration`'s behaviour is
  unchanged.

### Removed

- **The embedded MCP server is gone — Heorth is REST-only** (ADR 0008, task
  A7). Deleted `src/mcp/` (the per-request MCP-over-HTTP server and the `he_`
  key auth adapter), the `/mcp` route in `src/index.ts`, all seven module tool
  files (`src/household/mcp.ts`, `src/modules/{calendar,meals,library,
  inventory,tasks,feoh}/mcp.ts`, 37 tools), and their eight test files.
  `McpRegistry` is removed from `src/modules/registry.ts`, so the module
  contract is now `register(app)` and `createApp(modules)` takes no registry.
  The MCP surface lives in `Wyrhta-Labs/heorth-mcp`, a separate container that
  is a **pure REST client** — every deleted tool was a thin wrapper over a
  service function that the REST routes already call, so no domain logic was
  removed and **no REST route, response shape, status code, or guard changed**.
  The MCP SDK was never a direct dependency here (it arrives via
  `@wyrhta/core`), so `package.json` is unchanged.

### Changed — BREAKING

- The `inventory` module is now **Ethel** (ADR 0013). `/api/v1/inventory/items`
  is gone; use `/api/v1/ethel/assets`. Table `inventory_items` is `ethel_assets`,
  its `location` column is `location_note`, and the finance links are
  `feoh_item_costs.asset_id` and `recurring_bills.ethel_asset_id`. The web route
  is `/ethel`. **Renamed MCP tools break saved prompts** — `inventory.*` is now
  `ethel.*` in heorth-mcp, which must be deployed together with this release.

### Changed

- **`@wyrhta/core` pinned to v0.3.0 — the MCP SDK is gone from the dependency
  tree** (task A9, Wyrhta-Labs/wyrhta-labs#1; ADR 0008). Core v0.3.0 removes the
  `./mcp` scaffold (`createMcpServer`, `McpTool`, `AuthAdapter`,
  `McpPrincipal`) and drops `@modelcontextprotocol/sdk` entirely. Heorth stopped
  importing any of it in task A7, so this is a pin bump with no code change —
  but it is the observable payoff of the migration: `npm ls
  @modelcontextprotocol/sdk` is now empty and `package-lock.json` no longer
  mentions the SDK at all (3 references before, 0 after). Backend suite
  55 files / 373 tests and web suite 52 files / 262 tests are unchanged.

- **The KithLedger reminders feed now presents a `household` key, not a member
  key** (task B8, Wyrhta-Labs/wyrhta-labs#1; ADR 0004 §2). KithLedger split
  ADR 0004's three principals into three separate credentials, so a `kl_` key
  now carries a **kind** — `member` (that account's full personal scope, may
  write), `household` (the `household`-visible slice only, read-only,
  member-less) or `ops` (no data access). Heorth's `KITH_API_KEY` was
  backfilled as `member`, which meant the always-on Hearth wall was reading
  with the full personal scope of KithLedger's local admin account and could
  write. It now presents the **household dashboard credential**, the principal
  ADR 0004 §2.2 defines for exactly this surface.
  - **No member-JWT path was added.** `GET /api/v1/kith/reminders` authenticates
    the Heorth caller but never forwards that identity upstream, and every
    member sees the same wall — it is purely the household slice, so there is
    no member-scoped read to migrate. A future one would take a member token
    from `POST /api/v1/auth/satellite-token` (ADR 0009); until something needs
    it, none is built.
  - `KITH_API_KEY_KIND` (new, optional within the `KITH_*` group, default and
    only accepted value `household`) makes the credential's role explicit
    instead of implied, and `config.kith` carries `keyKind`. Nothing in a `kl_`
    key's text reveals its kind and KithLedger's key listing needs a
    local-account JWT Heorth does not hold, so this is a **declaration**, not a
    check: a deliberate `member`/`ops` value fails at boot with the migration
    procedure, while a member key pasted in silently cannot be detected here.
  - A refused credential is no longer indistinguishable from an outage: an
    upstream `401`/`403` now raises `KithCredentialError` and returns
    **`502 KITH_CREDENTIAL_REJECTED`** (with a `kith.credential.rejected` audit
    event, never the key) instead of `502 KITH_UNAVAILABLE`.
  - **Operator action required — the deployed key must be replaced.** Mint a
    household key in KithLedger as the local admin
    (`POST /api/v1/auth/keys {"name":"…","kind":"household"}`), put it in
    `deploy/`'s `KITH_API_KEY`, restart Heorth, then revoke the old member key.
    Full procedure: README.md, "KithLedger reminders".
  - **Expect fewer reminders on the wall.** A household key cannot see any
    member's `private` reminders, nor `shared`-subset ones (it is on no share
    list by design), and ADR 0004 §3.4 keeps them out of the counts too. Only
    `visibility: household` reminders — KithLedger's create-time default —
    reach the wall; a member who wants a carved-out reminder shown changes its
    visibility in KithLedger. The wall degrades quietly: a narrowed or empty
    list is an ordinary `200` with fewer chips, never an error state.

- **`FEOH_ENABLED` kill switch removed — finance is now always on.**
  `feohModule` mounts unconditionally in `ALL_MODULES`
  (`src/modules/index.ts`); `/api/v1/feoh/*` and `feoh.*` MCP tools are
  always present, and the web UI no longer needs to gate its finance nav on
  `GET /api/v1/features`. **Behavior change** for any deployment relying on
  the switch to hide finance — it is no longer possible to disable the
  module via env var.

### Added

- **Places**: `ethel_places` as a tree (building/floor/room/outdoor/storage) with
  a depth cap of 6, cycle rejection, and sibling-unique names. `GET/POST/PATCH/
  DELETE /api/v1/ethel/places`. An asset carries `placeId` and a free-text
  `locationNote`; `?placeId=&includeDescendants=true` filters a whole subtree.
- **Vehicle details**: `PUT/DELETE /api/v1/ethel/assets/:id/vehicle`.
- **Facility details**: `PUT/DELETE /api/v1/ethel/assets/:id/facility`, with the
  set of places each system serves, and `?hasFacility=`/`?servesPlaceId=` filters.
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

- **Ethel module** (`src/modules/ethel/`, ADR 0013) — the property register,
  replacing the earlier `inventory` module: assets with name/category/
  manufacturer/model/serial/place/location note/notes, purchase price/date,
  warranty, and a decommission/reactivation lifecycle. REST only
  (`/api/v1/ethel/assets`, with search/status/category/place filters and
  pagination) — a standalone, always-on `HeorthModule`. No dependency on feoh;
  the sole ethel→feoh touchpoint is a raw-SQL existence check against
  `feoh_item_costs.asset_id` (`hasDisposalLink` in `service.ts`) that blocks
  reactivating an asset with a recorded disposal link.
- **Recurring bill occurrences** (`src/modules/feoh/occurrences.ts`) — a
  bill's cadence projects into due-date entries with derived status
  (`planned`/`overdue`/`paid`/`skipped`/`unknown`); linking, skipping,
  unskipping, and overriding an occurrence persist a `recurring_occurrences`
  row only once it's touched, pruning back to pure projection when
  untouched again. Off-schedule (edited) rows always surface even past the
  listing's horizon.
- **Item cost links + total-cost-of-ownership** (`src/modules/feoh/
  item-costs.ts`) — links a transaction to an Ethel asset as a cost
  (purchase/disposal/repair/maintenance/accessory) and rolls up a per-asset
  TCO breakdown (capital + tier2 + recurring − proceeds, plus a per-year
  rate over the asset's lifetime).
- **Account ledger + Kassensturz reconciliation** (`src/modules/feoh/
  ledger.ts`) — a per-account running-balance ledger (Postgres window
  function over the full unfiltered history, so paginated balances stay
  correct) and a reconciliation flow that books an adjusting transaction
  between a physically counted balance and the ledger balance through a
  given date (asset accounts only, guarded against later postings that
  would silently shift).
- **German locale coverage** for the new Ethel, occurrences, and ledger/
  Kassensturz UI surfaces.
- Migration `0015_feoh-inventory-lifecycle.sql` for the Ethel + occurrences +
  item-cost tables.

### Fixed

- Recurring-occurrence override race: a concurrent insert on the same
  (billId, dueDate) now maps the underlying `23505` conflict to a
  classified error, matching the existing link/skip behavior, instead of
  leaking a raw 500.
- `ethel.list_assets` MCP tool now accepts `limit`/`offset`, matching the
  REST endpoint's pagination.
- Ethel's asset search escapes `%`/`_` in the ILIKE pattern so a literal
  wildcard character in a search term (e.g. `100%`) no longer wildcard-matches
  unrelated assets.
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

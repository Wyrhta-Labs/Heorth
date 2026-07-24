# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Microsoft 365 read-only calendar mirror** (Phase 2 Task 2.2): a
  provider-agnostic `CalendarProvider` / `MirroredEvent` contract
  (`src/modules/calendar/providers/`) with a Graph implementation
  (`src/m365/calendar-provider.ts`) over the Task 2.1 foundation — per-member
  **default calendar** (delegated) and the **family mailbox** (app-only) pulled
  via `calendarView/delta` on a rolling window (−60d … +400d); recurring events
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

### Changed

- Dev port moved to **4000** (`.env.example`, docker-compose host mapping,
  Vite proxy, README) and `FEOH_BASE_URL` dev default to `http://localhost:4001`,
  per the cross-service dev port allocation (Heorth 4000/5173, Feoh 4001,
  KithLedger 4002/5174). Container-internal port stays 3000.

### Added

- `README.md` (new) — quick start, API surface overview, Feoh satellite
  proxy summary, and the testing gotcha (export `DATABASE_URL` manually).

### Changed

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

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

# Heorth — Design (0.1 beta)

**Date:** 2026-07-11
**Status:** Approved design
**Depends on:** `@wyrhta/core`
**Repo:** `github.com/wyrhta-labs/heorth` (currently empty)
**Target:** 0.1 beta, Q3 2026

## Purpose

Heorth is the flagship household system: one self-hosted deployment per household, real member users with roles, and domain modules for the running of a home. API-first (REST + MCP) beneath a full React SPA.

**0.1 modules: Calendar + Meals + Feoh (Finance).** Chores, Library, and Garden are a deliberate later phase. **Feoh is a branded Finance module living inside Heorth** — not a separate project, not a plugin.

## Stack & conventions

Node.js 22 + TypeScript, Hono, Drizzle, PostgreSQL 16, Zod, Vitest — same as KithLedger. All plumbing (identity, envelope, middleware, MCP scaffold, DB conventions) comes from `@wyrhta/core`. React 18 + Vite + TanStack Router/Query + Tailwind + shadcn/ui SPA, served static from the API in prod.

Layering: `routes/` → `services/` → `db/`. Routes never touch Drizzle directly.

## Repo shape (module-per-domain)

```
src/
├── index.ts              # boot: run migrations, seed household, register modules, start REST + MCP
├── app.ts                # Hono app factory + core middleware wiring
├── config/env.ts         # Zod-validated env (extends core's requirements)
├── household/            # the one-household foundation
│   ├── schema.ts  service.ts  routes.ts  validators.ts  mcp.ts
├── modules/
│   ├── calendar/  { schema, service, routes, validators, mcp }
│   ├── meals/     { schema, service, routes, validators, mcp }
│   └── feoh/      { schema, service, routes, validators, mcp }   # Finance, branded Feoh
├── mcp/                  # assembles all modules' mcp tools via core's scaffold
└── db/                   # drizzle client + aggregated migrations
web/                      # React SPA (mirrors KithLedger's web/ layout)
```

**Module convention:** each module exports `register(app, mcpRegistry)` that mounts its REST routes and contributes its MCP tools. First-party, compile-time registration in `index.ts` — no dynamic/plugin loading. This is what lets Feoh sit cleanly beside Calendar and Meals.

## Foundation — Household & Members (built first)

- **Household** — singleton row seeded at first boot from env (name, timezone, locale). The instance *is* the household; no per-row scoping.
- **Members** — real users (core identity) belonging to the household. Each has a role (`admin` / `adult` / `child`) and a profile: display name + avatar color (the mockup's ember / taupe / sage / sky palette). Chores, meals, and expenses attribute to a member.
- **Auth flow** — first boot seeds household + an `admin` member from env. Admin creates/invites other members (adult/child). Each member logs in for their own JWT. API keys (`he_` prefix) are minted per agent. **Role scoping:** `child` has limited write scope (e.g. may complete their own assignments, may not edit finances); enforced with core's `requireRole`.
- REST: `/household`, `/members` (CRUD, role assignment — admin only). MCP: `household.get_members`, `household.whoami`.

## Module — Calendar

The dashboard backbone ("this week at home").

**Schema**
- `events` — id, title, start_at, end_at, all_day, location, notes, category, color, created_by (member), recurrence (ISO 8601 nullable — reuse KithLedger's recurrence pattern), timestamps.
- `event_attendees` — event_id, member_id.

**REST** — CRUD on `/events`; `GET /events?from=&to=&member_id=` powers week/range views; recurrence expanded server-side within a queried range.

**MCP** (`calendar.*`) — `list_events`, `create_event`, `update_event`, `move_event`, `list_upcoming`.

## Module — Meals

Recipes → weekly plan → generated shopping list.

**Schema**
- `recipes` — id, title, servings, ingredients (jsonb: `{ name, qty, unit }[]`), steps (jsonb string[]), tags (text[]), created_by.
- `meal_plan_entries` — id, date, slot (`breakfast`/`lunch`/`supper`), recipe_id (nullable) or free_text, cook (member), helper (member, nullable).
- `shopping_list_items` — id, name, qty, unit, checked, source_recipe_id (nullable — set when generated, null when hand-added).

**Behavior** — `POST /meals/shopping-list/generate?from=&to=` aggregates ingredients from the range's planned recipes into `shopping_list_items` (merging like items), after which the list is freely hand-editable. Matches the mockup's supper card + ingredient tags.

**REST** — `/recipes` CRUD; `/meals/plan` (get week `?from=&to=`, upsert entry); `/meals/shopping-list` (list, generate, check-off, add, remove).

**MCP** (`meals.*`) — `list_recipes`, `create_recipe`, `plan_meal`, `get_week_plan`, `generate_shopping_list`, `check_off_item`.

## Module — Feoh (Finance)

> **Superseded (2026-07, Phase 1 extraction).** Feoh is no longer an in-process
> Heorth module. The finance domain (this schema, service, MCP tools) was
> extracted into the standalone **Feoh satellite service** (its own repo + DB).
> Heorth now mounts a transparent **proxy** at the same `/api/v1/feoh/*` paths
> (`src/satellites/feoh/`) that forwards to Feoh authenticated with one service
> key, and mirrors household members into Feoh's `parties` boundary
> (`memberId ↔ partyId`). Two new env vars: `FEOH_BASE_URL`, `FEOH_API_KEY`.
> Feoh's own `feoh.*` MCP tools now live on the Feoh service's `/mcp`, not
> Heorth's. The section below documents the original in-Heorth design for the
> historical record.

Double-entry under the hood, envelopes on top. Plain text in, plain text out.

**Schema**
- `accounts` — id, name, kind (asset/liability), opening_balance.
- `envelopes` — id, name, monthly_budget, tone/color.
- `transactions` — id, date, payee, memo, amount, created_by.
- `postings` — id, transaction_id, account_id (nullable), envelope_id (nullable), debit, credit. The double-entry integrity layer; every transaction's postings must balance (sum debits = sum credits), enforced in the service inside a Drizzle transaction.
- `recurring_bills` — id, payee, amount, cadence (ISO 8601), next_due, envelope_id.
- `expense_splits` — id, transaction_id, member_id, share (amount or ratio) — fair allocation of a joint expense across members.

**Behavior**
- `record_transaction` writes the transaction + balancing postings atomically; unbalanced input is rejected.
- **CSV import/export** of transactions and a readable plaintext ledger export (the "plain text in, plain text out" promise; no proprietary lock-in).
- Month summary aggregates spend per envelope vs budget (the mockup's progress bars) and totals spent vs budget.

**REST** — `/feoh/accounts`, `/feoh/envelopes`, `/feoh/transactions` (CRUD), `/feoh/summary?month=`, `/feoh/bills`, `/feoh/import` (CSV), `/feoh/export` (CSV + ledger).

**MCP** (`feoh.*`) — `list_envelopes`, `record_transaction`, `get_month_summary`, `list_recurring_bills`, `import_csv`, `export_ledger`.

## MCP server

One MCP server per instance, assembled in `src/mcp/` from every module's tool registry via core's scaffold. Agents connect with an `he_` API key resolving to a member + role; every tool call runs the same role checks and audit logging as REST. Tools namespaced per module (`calendar.*`, `meals.*`, `feoh.*`, `household.*`).

## Web UI (full parity with website mockups)

React SPA, KithLedger's proven stack, honoring the brand design guide (serif display headings, ember/taupe/sage/sky member palette, hearth aesthetic). Types hand-synced in `web/src/lib/types.ts` (codegen later).

- **Dashboard** — "this week at home": day strip, tonight's supper card, today's calendar agenda, per-member avatars. (The mockup's *chores* card ships with the Chores module in the later phase — its slot in the dashboard layout is reserved but empty in 0.1.)
- **Calendar** — week/month views, event create/edit, attendee assignment, recurrence.
- **Meals** — recipe library, weekly planner (assign recipes to slots), shopping list with check-off.
- **Feoh** — month summary, envelope cards with progress bars, recurring bills list, transaction entry, CSV import/export (matches the Feoh mockup exactly).
- **Household** — member management, roles, login/auth, API-key management.

## Testing

Integration tests against a real Postgres (core's truncate-per-test harness, `singleFork: true`), covering REST + MCP tools per module and role-guard behavior (esp. `child` write limits and admin-only member management). Feoh gets explicit double-entry-balance and CSV round-trip tests.

## Environment (extends core)

```
DATABASE_URL=postgres://heorth:<pw>@localhost:5432/heorth
JWT_SECRET=<32+ chars>
HOUSEHOLD_NAME=<seed name>
ADMIN_EMAIL=<seed admin>
ADMIN_PASSWORD=<seed admin pw>
API_PORT=3000
CORS_ORIGIN=*
```

## Non-goals (0.1)

- Chores, Library, Garden modules (later phase).
- gRPC. Multi-household. Dynamic plugin runtime. API type codegen.

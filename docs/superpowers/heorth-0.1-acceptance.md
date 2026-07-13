# Heorth 0.1 — Acceptance Checklist

Each spec requirement maps to the plan task(s) that deliver it. Verify by running
`npm test` (backend + MCP) and `cd web && npm test && npm run build` (SPA), plus the
Task 8.1 green gate.

Gate results at release (Phase 8.1): backend 68 tests green (24 files, incl.
`integration-smoke`), `npm run typecheck` + `npm run build` clean; web 17 tests
green (8 files), `cd web && npm run build` emits `web/dist/index.html`.

## Foundation — Household & Members
- [x] Household singleton seeded at first boot from env (idempotent) — Task 0.5, 1.1
- [x] Members = core identity users with role (admin/adult/child) + profile (display name, avatar color ember/taupe/sage/sky) — Task 1.1, 1.2
- [x] Auth: first-boot admin seed; admin creates/invites members; per-member JWT login; `he_` API keys minted per agent — Task 0.5, 1.2
- [x] Role scoping: member management admin-only; `child` limited write scope — Task 1.2 (routes), enforced with core `requireRole`
- [x] REST `/household`, `/members`; MCP `household.get_members`, `household.whoami` — Task 1.2, 1.3

## Module — Calendar
- [x] `events` + `event_attendees` schema; ISO-8601 recurrence expanded server-side in a range — Task 3.1, 3.2
- [x] REST CRUD on `/events`; `GET /events?from=&to=&member_id=` range/week view — Task 3.3
- [x] MCP `calendar.{list_events,create_event,update_event,move_event,list_upcoming}` — Task 3.4
- [x] `child` may only modify events they created — Task 3.3 (routes), 3.4 (MCP)

## Module — Meals
- [x] `recipes`, `meal_plan_entries`, `shopping_list_items` schema — Task 4.1
- [x] `/recipes` CRUD; `/meals/plan` get/upsert; shopping-list generate (merge like items) + check-off/add/remove — Task 4.2, 4.3
- [x] MCP `meals.{list_recipes,create_recipe,plan_meal,get_week_plan,generate_shopping_list,check_off_item}` — Task 4.4

## Module — Feoh (Finance)
- [x] `accounts`, `envelopes`, `transactions`, `postings`, `recurring_bills`, `expense_splits` schema — Task 5.1
- [x] Double-entry: postings must balance, written atomically in a Drizzle transaction; unbalanced rejected — Task 5.3 (test: `feoh-transactions.test.ts`)
- [x] Month summary: spend per envelope vs budget + totals — Task 5.4
- [x] Recurring bills; expense splits — Task 5.3, 5.5
- [x] CSV import/export + plaintext ledger export (round-trip) — Task 5.6 (test: `feoh-csv.test.ts`)
- [x] Feoh writes: admin+adult only; `child` → 403 — Task 5.2, 5.3 (routes), 5.7 (MCP)
- [x] MCP `feoh.{list_envelopes,record_transaction,get_month_summary,list_recurring_bills,import_csv,export_ledger}` — Task 5.7

## MCP server
- [x] One server per instance assembled in `src/mcp/` from every module's registry via core's scaffold — Task 6.1
- [x] `he_` key → member + role; same role checks + audit logging as REST; tools namespaced per module — Task 6.1 (test: `mcp-server.test.ts`)
- [x] stdio/HTTP transport mounted on the server — Task 0.5 (`app.all('/mcp', ...)`), assembled in Task 6.1 (MCP-over-HTTP via StreamableHTTPServerTransport per user decision)

## Web UI (full parity, brand-honoring)
- [x] SPA stack (Vite + React 18 + TanStack Router/Query + Tailwind + shadcn/ui); envelope-aware Bearer client; hand-synced `lib/types.ts`; auth/login — Task 7.1, 7.2
- [x] App shell + routing + member avatars (ember/taupe/sage/sky) — Task 7.2
- [x] Dashboard "this week at home": day strip, tonight's supper card, today's agenda, member avatars; chores slot reserved-but-empty — Task 7.3
- [x] Calendar: week/month views, event create/edit, attendee assignment, recurrence — Task 7.4
- [x] Meals: recipe library, weekly planner, shopping list with check-off + generate — Task 7.5
- [x] Feoh: month summary, envelope cards with progress bars, recurring bills, transaction entry, CSV import/export — Task 7.6
- [x] Household: member management, roles, login, API-key management — Task 7.2 (login), 7.7
- [x] Brand: serif display headings (Fraunces), parchment/ember palette — Task 7.1 (`index.css`)

## Testing (spec)
- [x] Integration tests vs real Postgres, truncate-per-test, `singleFork` — Task 0.1, 0.3; exercised throughout Phases 1-6, 8.1
- [x] REST + MCP per module + role guards (esp. `child` limits, admin-only member mgmt) — Phases 1-6, 8.1
- [x] Feoh double-entry-balance + CSV round-trip tests — Task 5.3, 5.6

## Non-goals confirmed absent (0.1)
- [x] No Chores / Library / Garden modules (dashboard chores slot is a placeholder only) — Task 7.3
- [x] No gRPC, no multi-household, no dynamic plugin runtime, no API type codegen

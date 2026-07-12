# Heorth 0.1 — subagent-driven execution (plan: 2026-07-11-heorth-0.1.md, ~34 tasks, 8 phases)
Branch: feat/heorth-0.1
Core dep: github:Wyrhta-Labs/wyrhta-core#v0.1.1
Test DB: Postgres container kith-testdb host:55432 database `heorth`. `set -a && source .env && set +a` before test/db cmds.
Reconciliations: see .superpowers/sdd/core-reconciliations.md (auth->principal, no *Service factories,
  createApiKey->.key, seedHousehold does NOT seed admin, MCP stdio-only [Phase 6 HTTP decision], he_ prefix).

## Ledger
- Phase 0 scaffold: 0.1 complete (base 3301e84 -> d87da4b, core@0.1.1 resolved). 0.1-0.2 complete (04d6089). 0.1-0.4 complete. 0.4 app factory + 0000 migration; 0.5 boot (seed household+admin). PHASE 0 COMPLETE: 7 tests green, typecheck clean.

## DECISIONS (user, 2026-07-12): full plan phase-by-phase (check in at each phase boundary);
## MCP transport = wire HTTP (StreamableHTTPServerTransport on Hono) at Phase 6.
## Phase 0 commits: 0.1 d87da4b, 0.2 04d6089, 0.3 c806029, 0.4 60329e8, 0.5 <this>.
## Task 0.5 controller-implemented (heavy reconciliation): bootstrap()={app} returns; MCP deferred to Phase 6.
## Phase 1: 1.1 complete (wiring.ts + household service/validators/helpers, 12 tests). 1.2 next (routes).
##   directly on the users table in the wiring layer (Phase 1.1/1.2). Auth guards: build via core
##   createAuthGuards({jwtSecret,keyPrefix:'he_',resolveApiKey}); normalize principal->auth in a wrapper.
- Phase 1 COMPLETE: 1.1 (8138d23 wiring+service), 1.2 (dcd3937 routes) + 8528991 (wiring passwordHash strip),
  1.3 MCP tools. Phase 2 (2.1): invokeTool helper + convention test. 
  MCP tool pattern established: inputSchema=ZodRawShape ({} for none), handler->McpToolResult
  ({content:[{type:'text',text:JSON.stringify(x)}]}), ctx.principal.userId. Reuse for Calendar/Meals/Feoh MCP.
- Phase 2 COMPLETE: 2.1 (6509609) invokeTool helper + module-convention test.
- Phase 3 COMPLETE (Calendar): 3.1 (519b02e schema+recurrence+migration 0001), 3.2 (ff6cd17 service+validators),
  3.3 (2f63772 routes+child-scope guard), 3.4 (b4a0bfd MCP tools). Full suite 34 tests green.
  Calendar MCP reused the established pattern (ZodRawShape inputSchema, McpToolResult, ctx.principal).
## Next: Phase 4 (Meals 4.1-4.4), Phase 5 (Feoh 5.1-5.7), Phase 6 (MCP HTTP), Phase 7 (SPA), Phase 8.
- Phase 4 COMPLETE (Meals): 4.1 (b88a30e schema+migration 0002), 4.2 (49d3082 recipes+meal-plan service/routes),
  4.3 (29c423f shopping-list generation, like-item merge), 4.4 (3c783f9 MCP tools). Full suite 40 tests green.

## ========================= RESUME HERE (new session) =========================
## STATE: Phases 0-4 COMPLETE. Branch feat/heorth-0.1 @ HEAD 3c783f9. 40 tests green, typecheck+build clean.
## Modules live: Household (foundation+wiring), Calendar, Meals. Migrations 0000(core),0001(calendar),0002(meals).
##
## NEXT: Phase 5 — Feoh (Finance), 7 tasks (plan lines ~3126-4351):
##   5.1 schema+migration (3130-3252), 5.2 accounts+envelopes (3253-3533),
##   5.3 double-entry transactions (3534-3752), 5.4 month summary (3753-3863),
##   5.5 recurring bills (3864-3967), 5.6 CSV import/export (3968-4203), 5.7 Feoh MCP tools (4204-4351).
## Then Phase 6 (MCP-over-HTTP assembly, lines 4356+), Phase 7 (React SPA 7.1-7.7), Phase 8 (integration/release).
##
## HOW TO RESUME:
##  - Use superpowers:subagent-driven-development. Extract each task via: sed -n 'START,ENDp' <plan> > brief.
##  - Plan: ../Heorth/docs/superpowers/plans/2026-07-11-heorth-0.1.md (this repo, docs/).
##  - Test env: Docker container `kith-testdb` (start Docker Desktop if down) exposes Postgres on host 55432;
##    database `heorth` already created. `.env` (gitignored) is at repo root. ALWAYS `set -a && source .env && set +a`
##    before npm test / typecheck / db:generate.
##  - RECONCILIATIONS (see core-reconciliations.md): route guards import from '../../wiring.js' (sets c.get('auth'));
##    MCP tools use ZodRawShape inputSchema + McpToolResult ({content:[{type:'text',text:JSON.stringify(x)}]}) +
##    ctx.principal.userId (reference src/modules/calendar/mcp.ts or meals/mcp.ts). Money = numeric(14,2) as strings.
##    core has no createIdentityService/createHouseholdService/getUser/updateUser/deleteUser — all in src/wiring.ts.
##  - Phase 6 decision (user-approved): wire MCP-over-HTTP via @modelcontextprotocol/sdk StreamableHTTPServerTransport
##    on the Hono app (bootstrap() currently returns {app}; extend to mount the MCP server + add the SDK as a dep).
##  - Commit per task; NO Co-Authored-By trailer; branch not yet pushed.

## ===== PHASE 5 (Feoh) execution log =====
- Task 5.1: complete (commit 5e5704c, review clean). Schema+migration 0003. 41 tests green.
##   MINOR (deferred to final review, both plan-mandated): (a) feoh-schema.test only exercises envelopes,
##   not the 6 tables' FK cascade/CHECK behavior; (b) no indexes on FK columns (postings.*, expenseSplits.*).
- Task 5.2: complete (commit a5b64e3, review clean). Accounts+envelopes service/routes, module registered. 43 tests green.
##   Auth reconciliation applied: guards imported from '../../wiring.js' (NOT @wyrhta/core/auth). validators.ts
##   forward-declares txn/bill schemas for 5.3-5.5. MINOR (plan-mandated, defer): unused `export {canWrite}`;
##   update* sets updatedAt even on empty patch; accounts CRUD untested (only envelopes+role gating).
- Task 5.3: complete (commits 0bee058 impl, 25a8708 fix, re-review clean). Double-entry txns + splits + routes.
##   IMPORTANT finding fixed: added mid-tx FK-violation rollback test proving atomicity (5th test, genuine 23503).
##   Dropped unused `type Posting` import. 48 tests green. MINOR (defer): count query trusts ::int cast.
- Task 5.4: complete (commit 75370a7, review clean). getMonthSummary + GET /summary. 49 tests green.
##   MINOR (plan-mandated/defer): extra `tone` field in summary output (in brief code); zero-postings envelope
##   coverage gap; redundant lte+< upper bound (plan-mandated, < is authoritative).
- Task 5.5: complete (commit f6c4c47, review clean). Recurring bills CRUD. Imports merged cleanly. 50 tests green.
##   MINOR (defer): bills test only happy path (no update/delete/404/child-gating tests).
- Task 5.6: complete (commits 630cdb4 impl, 3a48713 fix, re-review clean). CSV import/export + ledger + csv.ts parser.
##   acctByName name->id correction applied. IMPORTANT fixed: import now validate-all-then-write, throws
##   UNKNOWN_REFERENCE (route->400) on unresolved non-empty envelope/account names (no floating postings). 53 tests.
##   MINOR (defer, plan-locked): export amount uses String(Number(x)) dropping trailing zeros (test expects '50'/'4.5').
- Task 5.7: complete (commit 552b2a3, review clean). Feoh MCP tools (6 tools, child write-guard).
##   RECONCILED: brief's mcp.ts used stale interface; shipped version matches live calendar/mcp.ts pattern
##   (ZodRawShape inputSchema, result()->McpToolResult, ctx.principal.*). UNBALANCED->'Postings do not balance'.
##   MINOR (defer): import_csv/export_ledger MCP gating not directly tested (assertCanWrite shared, proven via record_transaction).
##
## ========== PHASE 5 COMPLETE (2026-07-12) ==========
## Feoh module fully landed on feat/heorth-0.1. HEAD 552b2a3. 55 tests green, typecheck+build clean.
## Commits: 5e5704c(5.1) a5b64e3(5.2) 0bee058+25a8708(5.3) 75370a7(5.4) f6c4c47(5.5) 630cdb4+3a48713(5.6) 552b2a3(5.7).
## Deferred MINOR findings rolled up above -> feed to final whole-branch review.
## NEXT: Phase 6 (MCP-over-HTTP assembly/entrypoint, plan lines 4356+), Phase 7 (React SPA 7.1-7.7), Phase 8 (integration/release).
## Per user DECISION: check in at each phase boundary -> PAUSED for check-in before Phase 6.
##
## PHASE 5 WHOLE-PHASE REVIEW (user-requested, opus reviewer) + FIX:
## Found CRITICAL cross-surface hole: posting-reference invariant ("account OR envelope") was only in the REST
## validator, so MCP record_transaction (adult) + CSV empty-name rows could commit balanced-but-ORPHANED postings.
## FIXED @ 4a1cf8f: enforce in service.recordTransaction (throw ORPHAN_POSTING) -> all 3 surfaces inherit; mapped
## on MCP+REST. CSV import now validate-all-then-write over ALL rows (date format+CALENDAR validity via
## isValidCalendarDate, amount finite, non-orphan) so malformed rows abort before any write (true all-or-nothing);
## missing required header column -> 400 CSV_INVALID_HEADER. +5 tests (now 60 green). Re-review: all resolved, approved.
## DEFERRED for USER DECISION (not auto-fixed): (a) CSV export lossy for >2-posting txns (exports first env+acct only)
## -> plan's CSV format is inherently single-envelope; document or accept for 0.1; (b) CSV formula-injection on export
## (=/+/-/@ prefixes not neutralized) -> low risk single-tenant; (c) accepted-for-0.1 minors per triage (FK indexes,
## accounts CRUD tests, bills tests, summary counts debits-only, export trailing-zero). HEAD now 4a1cf8f.
##
## USER DECISION on the two deferred items (2026-07-12): FIX BOTH.
## @ 3d4ffa1: (a) CSV formula-injection guard sanitizeCsvText() prefixes ' to free-text fields starting with
##   =+-@/tab/CR (payee/memo/envelope/account only; NOT date/amount); (b) export now emits one row per
##   envelope-posting (amount=that posting's debit) so multi-envelope txns don't drop legs. 62 tests green.
##   CAVEAT: multi-envelope txns re-import as SEPARATE 2-posting txns (no data loss; grouping not round-tripped,
##   would need a transaction-id column - out of scope). Re-review approved.
##
## ===== PHASE 5 FULLY DONE + REVIEWED + HARDENED. HEAD 3d4ffa1. 62 tests green, typecheck+build clean. =====
## USER STOPPED HERE (did NOT start Phase 6). Branch feat/heorth-0.1 NOT pushed.
## RESUME: Phase 6 (MCP-over-HTTP assembly, plan lines 4356+; wire StreamableHTTPServerTransport on Hono,
##   extract src/mcp/, add @modelcontextprotocol/sdk dep), then Phase 7 (React 18 SPA 7.1-7.7), Phase 8.

## ===== PHASE 6 (MCP-over-HTTP assembly) execution log =====
- Task 6.1: complete (commit a3028f3, review APPROVED by opus reviewer). src/mcp/{auth-adapter,server}.ts,
  bootstrap() refactor, tests/mcp-server.test.ts. 67 tests green (5 new), typecheck+build clean.
##   RECONCILED vs brief (all verified correct against real core API): no createIdentityService -> used wiring.ts
##   `identity` singleton; validateApiKey returns Principal ({type,userId,role}) not {user,apiKeyId}; createApiKey
##   is 2-arg (he_ baked in) returning key.key not key.raw; core createMcpServer(registry,authAdapter,info)->SDK
##   McpServer with zero-arg resolve() (NOT .fetch()). Bridged via per-request McpServer + MCP SDK
##   WebStandardStreamableHTTPServerTransport (fresh server per HTTP request, stateless, key closed over request).
##   MINOR findings (defer to final whole-branch review):
##     (a) [transport coverage] per-request HTTP transport path only asserted via typeof server.fetch==='function';
##         no live MCP initialize->tool-call handshake round-trip. Reviewer recommends follow-up e2e /mcp test.
##     (b) [audit gap] missing-Authorization-header case throws MCP_UNAUTHORIZED before Heorth adapter runs, so it
##         emits NO mcp.auth.failure event (only present-but-invalid keys log failure). server.ts:150-155.
##     (c) api_key_id not in mcp.auth.success (resolveApiKey doesn't surface key row id) - per-member audit only.
##     (d) toCoreAuthAdapter re-declares resolver sig inline instead of reusing McpAuthAdapter type (cosmetic).
##
## ========== PHASE 6 COMPLETE (2026-07-12) ==========
## MCP-over-HTTP assembly landed on feat/heorth-0.1. HEAD a3028f3. 67 tests green, typecheck+build clean.
## Backend is now feature-complete (Phases 0-6). Per user DECISION (check in at each phase boundary) -> PAUSED.
## NEXT: Phase 7 (React 18 SPA, tasks 7.1-7.7, plan lines 4582+), then Phase 8 (integration/release).

## ===== PHASE 7 (React 18 web SPA) execution log =====
- Task 7.1: complete (commit 22bb8e8 scaffold, 3f67b5c tsconfig fix; review APPROVED by sonnet reviewer).
  web/ toolchain (vite/vitest/ts/tailwind v4), lib/{utils,types,format,constants}.ts, api/client.ts, format.test.ts.
  React 18 pin verified; envelope-aware Bearer (he_jwt) client; money string-vs-number split correct; brand hex verbatim.
  5 web tests green. RECONCILED: vitest setupFiles -> absolute resolve(__dirname) path to avoid parent-repo
  tests/setup.ts collision on Windows (sound, verified). FIXED (Important, plan-inherited): brief's tsconfig.node.json
  had composite+noEmit -> TS6310 broke `npm run build`; corrected to emit-legal (3f67b5c). tsc -b clean.
##   KNOWN SCAFFOLD STATE: `npm run build` still exits 1 ONLY because web/src/main.tsx imports './app' (app.tsx
##   created in Task 7.2). Build turns green after 7.2. NON-issue - inherent to phased scaffold; Phase 8 is the build gate.
##   NON-ISSUES confirmed by reviewer: MONTH_SLOTS/apiText prose-only typos in brief (real names MEAL_SLOTS +
##   apiGetText/apiPostText, used correctly by later tasks). MINOR (defer to final): tsconfig.node.json emit artifacts
##   must stay gitignored (fixer handled).
- Task 7.2: complete (commit 56e1a2b; review APPROVED by sonnet reviewer). shadcn ui primitives, auth flow
  (use-auth, TOKEN_KEY he_jwt), app shell + TanStack Router with beforeLoad redirect guard (genuine nav block),
  member avatars (MEMBER_COLORS exact brand hex), api/{auth,household}.ts + hooks reusing 7.1 client (no dup).
  `npm run build` now GREEN (dist/index.html). 7/7 web tests (avatar test asserts real backgroundColor). 24 files verbatim.
##   MINOR (defer to final, both plan-inherited/verbatim from brief): (a) login.tsx always navigates to '/' after
##   login, ignoring the guard's redirect search param -> deep-link-after-login lands on Dashboard not original page;
##   (b) useSetMemberRole re-types role union inline instead of importing Role from @/lib/types.
- Task 7.3: complete (commit a81fae5; review APPROVED by sonnet reviewer). Calendar+Meals api modules + hooks
  (reuse 7.1 client + QUERY_KEYS, no envelope re-parse), Dashboard "this week at home" (day strip, supper card,
  agenda, members row, reserved chores placeholder). Brand hex VERIFIED end-to-end in index.css + MEMBER_COLORS.
  8/8 web tests (day-strip asserts real per-day text), build green. MINOR (defer, cosmetic/plan-inherited): split
  imports in supper-card.tsx; qs() cast in calendar.ts.

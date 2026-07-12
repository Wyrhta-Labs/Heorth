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

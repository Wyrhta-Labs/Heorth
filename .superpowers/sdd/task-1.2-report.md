# Task 1.2 Report — Household/members/auth REST routes + module registration

## TDD cycle

**RED:** Wrote `tests/household-routes.test.ts` verbatim from the brief (6 tests). Ran
`npm test -- tests/household-routes.test.ts` before any implementation existed:
failed with `Error: Cannot find module '../src/household/index.js'` — confirmed RED.

**GREEN:** Implemented, applying all corrections from the task instructions (not the
brief's original routes.ts, which imported APIs that don't exist in this repo):

1. Guards imported from `../wiring.js` (`requireAuth`, `requireJwt`, `requireRole`),
   plus `identity` from the same module (no `identityService` export exists).
2. `ok`, `err`, `rateLimit` from `@wyrhta/core/http`; `logEvent` from `@wyrhta/core/lib`;
   `* as service` from `./service.js`; validators from `./validators.js`.
3. `householdRouter.use('*', requireAuth)` added as the first line so `PATCH /` (which
   only has `requireRole('admin')`) is actually authenticated first; `GET /` keeps no
   redundant inline guard since the router-level `use` covers it.
4. Key routes rewired to the actual `identity` wrapper signatures:
   - `GET /keys` → `identity.listApiKeys(c.get('auth').userId)`.
   - `POST /keys` → `identity.createApiKey(c.get('auth').userId, body.data.name)` (two
     args — the `he_` prefix is baked into the wiring wrapper); returns `ok(c, key, undefined, 201)`.
   - `DELETE /keys/:id` → `identity.revokeApiKey(c.get('auth').userId, id)` returns a
     boolean; `if (!revoked) return err(c, 'NOT_FOUND', ..., 404)`, else `ok(c, { id })`.
5. Members/household/auth-token logic transcribed as-is from the brief (EMAIL_TAKEN →
   409, CANNOT_DELETE_SELF → 403, LAST_ADMIN → 409, self-vs-admin PATCH check reading
   `c.get('auth')`).
6. `src/household/mcp.ts` placeholder (`export const householdTools: McpTool[] = [];`)
   and `src/household/index.ts` (`householdModule` mounting the three routers +
   `mcp.add(...householdTools)`), matching the brief.
7. `src/modules/index.ts` updated to import and register `householdModule` in
   `ALL_MODULES`.

Ran `npm test -- tests/household-routes.test.ts` again: **6/6 PASS**.

## Verification

- `npm run typecheck` (`tsc --noEmit`): clean, no errors.
- `npm test` (full suite, DB-backed): **5 test files, 18 tests, all passed** (health,
  household-routes, plus the pre-existing Task 1.1 service/wiring suites).

## Files changed (this commit)

- `src/household/routes.ts` (new) — household/members/auth Hono routers.
- `src/household/index.ts` (new) — `householdModule` registration.
- `src/household/mcp.ts` (new) — MCP tools placeholder (fleshed out in Task 1.3).
- `src/modules/index.ts` (modified) — registers `householdModule` in `ALL_MODULES`.
- `tests/household-routes.test.ts` (new) — the 6 verbatim brief tests.

## Git integrity

- `git status --short` after commit: only pre-existing, out-of-scope items remain
  (see Concerns) — nothing from this task is unstaged.
- `git show --stat HEAD` lists exactly the 5 files above, 238 insertions / 2 deletions.
- Commit: `dcd3937` — `feat: add household/members/auth REST routes with role guards
  and register the module`. No `Co-Authored-By` trailer.

## Concerns

- `src/wiring.ts` has an **uncommitted** working-tree modification (adds a
  `PublicUser` type + `stripPassword` helper so `getUser`/`updateUser`/`deleteUser`
  strip `passwordHash`) that predates this task — I did not author or touch it this
  session. It is not part of Task 1.2's file list, so it was deliberately left out of
  this commit per the task's explicit "stage only these 5 files" instruction. Since
  the brief's context said "Tasks 0.1-1.1 committed," this stray diff should be
  reconciled (committed as part of 1.1, or reverted) before/alongside a future task —
  flagging it so it isn't silently lost.
- `.superpowers/` is untracked in this repo; left as-is (not part of this task's scope).
- Brief's original `routes.ts` in `task-1.2-brief.md` (Step 3) is now stale/incorrect
  relative to what was actually implemented — kept the brief file itself unmodified
  since it's a planning artifact, not a deliverable.

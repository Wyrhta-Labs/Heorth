# Task 3.3 Report: Calendar REST routes + child-scope guard + module registration

## TDD cycle

- **RED**: Wrote `tests/calendar-routes.test.ts` verbatim from the brief (3 tests: create+list in range, child own-vs-other event mutation guard, move event). Ran
  `npm test -- tests/calendar-routes.test.ts` → failed with
  `Cannot find module '../src/modules/calendar/index.js'` (calendarModule did not exist yet), as expected.
- **GREEN**: Implemented `src/modules/calendar/routes.ts`, `src/modules/calendar/mcp.ts`, `src/modules/calendar/index.ts`,
  and registered `calendarModule` in `src/modules/index.ts`. Re-ran the same test command → 3/3 passed.

## Correction applied

Per instructions, changed the guard import in `routes.ts` from the brief's
`import { requireAuth } from '@wyrhta/core/auth';` to
`import { requireAuth } from '../../wiring.js';`, since Heorth's wiring layer wraps
`requireAuth` to populate the `auth` context key (`c.get('auth')`) that the handlers
and `assertCanMutate` read. Everything else in `routes.ts` was transcribed as written,
including `assertCanMutate(c: Parameters<typeof requireAuth>[0], id: string)` and the
call to `service.getEventOwner(id)` (already present in `src/modules/calendar/service.ts`).

## Files

- Created: `src/modules/calendar/routes.ts` — calendar router mounted with `requireAuth`,
  child-scope guard (`assertCanMutate`) applied to PATCH/`/move`/DELETE.
- Created: `src/modules/calendar/mcp.ts` — placeholder `calendarTools: McpTool[] = []`
  (to be filled in Task 3.4).
- Created: `src/modules/calendar/index.ts` — `calendarModule: HeorthModule` mounting the
  router at `/api/v1/events` and registering (empty) MCP tools.
- Modified: `src/modules/index.ts` — added `calendarModule` import and to `ALL_MODULES`
  (household + calendar now registered; meals/feoh remain as a follow-up comment).
- Test: `tests/calendar-routes.test.ts` — verbatim from the brief.

## Verification

- `npm test -- tests/calendar-routes.test.ts` → **3 passed** (3 tests).
- `npm run typecheck` → clean, no errors.
- Full `npm test` → **10 test files passed, 32 tests passed** (up from 29 before this task,
  +3 new calendar-routes tests).

## Git integrity

- `git show --stat HEAD` lists exactly the 5 expected files: `src/modules/calendar/index.ts`,
  `src/modules/calendar/mcp.ts`, `src/modules/calendar/routes.ts`, `src/modules/index.ts`,
  `tests/calendar-routes.test.ts`.
- `git status --short` after commit shows only the pre-existing untracked `.superpowers/`
  directory (unrelated to this task's file set; not staged or committed). No `.env` was
  staged or committed.
- Commit: `feat: add calendar REST routes with child-scope guard and register module`
  (no Co-Authored-By trailer, per instructions).

## Concerns

- None blocking. The `assertCanMutate` guard only restricts `child` role; `adult` and
  `admin` can mutate any event, matching the brief's stated scope (child-only restriction).
- `.superpowers/` is untracked in the repo (pre-existing, holds the brief/report docs) — left
  as-is since it wasn't part of the specified file set for this task's commit.

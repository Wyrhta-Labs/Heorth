# Task 3.4 report: Calendar MCP tools

## TDD

- **RED**: Wrote `tests/calendar-mcp.test.ts` verbatim from the brief (2 tests). Ran
  `npm test -- tests/calendar-mcp.test.ts` against the empty `calendarTools = []` stub —
  both tests failed with `MCP tool not found: calendar.create_event`, confirming the tests
  exercise the real implementation.
- **GREEN**: Implemented `src/modules/calendar/mcp.ts` against core's actual `McpTool` API
  (raw-shape `inputSchema`, `McpToolResult`-returning handlers, `ctx.principal.{userId,role}`),
  per the reconciliation notes (the brief's draft targeted an older/wrong MCP shape using
  `z.object(...)` schemas and `ctx.userId`/`ctx.role`). Re-ran the same test file — both
  tests passed.

## Files

- `src/modules/calendar/mcp.ts` — replaced stub with 5 tools: `calendar.list_events`,
  `calendar.create_event`, `calendar.update_event`, `calendar.move_event`,
  `calendar.list_upcoming`. Added local `result()` helper (mirrors `src/household/mcp.ts`)
  and `assertCanMutate(ctx, id)` enforcing the child-scope rule (children may only mutate
  events they created; throws `'Children may only edit their own events'`, matched by the
  test's `/own events/`).
- `tests/calendar-mcp.test.ts` — new, verbatim from brief.

## Typecheck

`set -a && source .env && set +a && npm run typecheck` — clean, no errors.

## Full suite

`set -a && source .env && set +a && npm test` — **11 test files, 34 tests, all passed**
(32 pre-existing + 2 new).

## Git integrity

- Commit `b4a0bfd` "feat: add calendar MCP tools with child-scope enforcement" —
  2 files changed (`src/modules/calendar/mcp.ts`, `tests/calendar-mcp.test.ts`), no
  Co-Authored-By trailer.
- `git status`: clean except untracked `.superpowers/` (SDD planning docs, outside this
  task's file scope — not committed).
- `git show --stat HEAD` confirms exactly the two intended files.
- `.env` not staged/committed.

## Concerns

- None blocking. Note for future tasks: the brief's draft `mcp.ts` code block (Step 3) uses
  the wrong MCP API shape and should not be copied verbatim for any remaining tasks —
  always cross-check against `src/household/mcp.ts` and
  `wyrhta-core/src/mcp/types.ts` first.

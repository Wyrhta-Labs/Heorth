# Task 0.4 Report: App factory, health route & module registry contract

## Status: BLOCKED — cannot commit (tests do not pass 2/2 as required)

All three source files and the test file were written exactly as transcribed from
`task-0.4-brief.md`. `npm run typecheck` is clean. However `npm test -- tests/health.test.ts`
fails in `tests/setup.ts`'s `beforeAll` migration step, before either test in
`tests/health.test.ts` runs — both are reported as "skipped", and the file fails overall.
Per the task instructions ("If the health test can't run because of the missing-migrations
harness, report it as a concern with the exact error rather than working around it. Do NOT
invent migrations."), I stopped short of committing rather than fabricate a migrations
journal or otherwise work around the harness.

## TDD sequence

### RED
Wrote `tests/health.test.ts` verbatim from the brief. Ran:

```
set -a && source .env && set +a && npm test -- tests/health.test.ts
```

Result: FAIL as expected —
`Error: Cannot find module '../src/app.js' imported from '.../tests/health.test.ts'`
(`createApp` not found — confirms RED).

### Implementation
Created, verbatim from the brief:
- `src/modules/registry.ts` — `McpRegistry` class + `HeorthModule` interface.
- `src/routes/health.ts` — `healthRouter` with `GET /health` → `ok(c, { status: 'ok' })`.
- `src/app.ts` — `createApp(modules)` factory: `trimTrailingSlash`, `requestId`,
  `securityHeaders`, `logger()`, `cors({ origin: config.corsOrigin })`,
  `/api/*` `bodyLimit`, mounts `healthRouter` at `/`, runs each module's
  `register(app, mcp)`, JSON 404 handler on `/api/*`, SPA `serveStatic` fallback
  for `./web/dist`, `app.onError(errorHandler)`. Also exports `collectMcpTools`.
  Includes the `declare module 'hono' { interface ContextVariableMap { auth: {...};
  requestId: string } }` augmentation exactly as specified (per your note: `auth` is
  intentionally left as-is; core's guards actually set `principal`, reconciliation
  is deferred to a future auth-wiring task — this task exercises no auth).

All imports (`requestId`, `securityHeaders`, `errorHandler` from `@wyrhta/core/http`;
`Role` type from `@wyrhta/core/identity`; `McpTool` from `@wyrhta/core/mcp`) resolved
without alteration, confirming they're exported as bare values/types in the installed
`@wyrhta/core@0.1.1`.

### GREEN attempt — BLOCKED by test harness

```
set -a && source .env && set +a && npm test -- tests/health.test.ts
```

Output:

```
stderr | tests/health.test.ts
serveStatic: root path './web/dist' is not found, are you sure it's correct?
serveStatic: root path './web/dist' is not found, are you sure it's correct?

❯ tests/health.test.ts (2 tests | 2 skipped) 7ms
  ↓ health > returns ok from /health
  ↓ health > returns JSON 404 for unknown api routes

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

FAIL tests/health.test.ts [ tests/health.test.ts ]
Error: Can't find meta/_journal.json file
 ❯ readMigrationFiles node_modules/src/migrator.ts:29:9
 ❯ migrate node_modules/src/postgres-js/migrator.ts:9:21
 ❯ tests/setup.ts:15:9
    13|
    14| beforeAll(async () => {
    15|   await migrate(db, { migrationsFolder: './src/db/migrations' });
      |        ^
    16| });

Test Files  1 failed (1)
     Tests  2 skipped (2)
```

**Root cause**: `src/db/migrations` does not exist at all (confirmed via
`ls src/db/migrations` → "No such file or directory") — there is no folder, and
therefore no `meta/_journal.json`, for `drizzle-orm/postgres-js/migrator`'s
`migrate()` to read. This is not a "no-op over an empty folder" situation as
hypothesized in the task description; it's a hard throw inside `readMigrationFiles`
that aborts `beforeAll` before any test in the file executes (Vitest marks both
tests "skipped" and the suite as failed).

The `serveStatic: root path './web/dist' is not found` stderr lines are harmless —
expected, since `web/dist` doesn't exist yet in Task 0.4's scope, and Hono's
`serveStatic` middleware only warns, it doesn't throw.

Because `tests/setup.ts` (from Task 0.3) unconditionally runs migrate() in
`beforeAll` for every test file — including this one, which needs no DB — the
health test cannot execute at all until either (a) a `src/db/migrations` folder
with a valid (even empty) Drizzle journal is generated via `db:generate`, or
(b) `tests/setup.ts`'s migration step is made conditional/skippable for
DB-independent test files. Per instructions, I did not create migrations or
touch `tests/setup.ts` to work around this.

### Typecheck — CLEAN

```
set -a && source .env && set +a && npm run typecheck
```

Output: clean, no errors (`tsc --noEmit` exits 0 with no output).

## Files written (not committed)

- `c:\Users\ChristianFoellmann\projects\Wyrhta-Labs\Heorth\src\app.ts`
- `c:\Users\ChristianFoellmann\projects\Wyrhta-Labs\Heorth\src\routes\health.ts`
- `c:\Users\ChristianFoellmann\projects\Wyrhta-Labs\Heorth\src\modules\registry.ts`
- `c:\Users\ChristianFoellmann\projects\Wyrhta-Labs\Heorth\tests\health.test.ts`

## Git state

Working tree has these 4 new files untracked (plus the pre-existing untracked
`.superpowers/` directory from prior tasks). **No commit was made** — the brief's
gate ("npm test -- tests/health.test.ts PASS (2 tests) → npm run typecheck clean →
commit") was not satisfied because the test run fails at the harness level, not
because of anything wrong in the Task 0.4 code itself. Committing now would violate
the explicit TDD gate in the task instructions.

## Concern requiring your decision

`tests/setup.ts` (Task 0.3) needs either:
1. A generated `src/db/migrations` folder (via `npm run db:generate` against the
   current schema) so `meta/_journal.json` exists (even describing zero migrations
   would still need the journal file structure Drizzle expects), or
2. `tests/setup.ts` changed to make the `migrate()` call conditional/best-effort
   (e.g. skip when the migrations folder or journal is absent) so DB-independent
   test files like `tests/health.test.ts` aren't blocked by DB/migration state.

I did not choose either option myself, per your instruction not to invent
migrations or work around the harness. Awaiting direction on how you want the
migrations/harness gap closed before Task 0.4 can reach a committed GREEN state.

# Task 0.3 Report — DB client, schema aggregation & test harness

## Confirmed core export names

Ran against installed `@wyrhta/core@v0.1.1`:

```
node --input-type=module -e "import('@wyrhta/core/identity').then(m=>console.log(Object.keys(m)))"
→ [ 'apiKeys', 'authenticate', 'createApiKey', 'createUser', 'generateKey', 'hashKey',
    'hashPassword', 'isUniqueViolation', 'issueToken', 'listApiKeys', 'revokeApiKey',
    'signToken', 'userRole', 'users', 'validateApiKey', 'verifyPassword', 'verifyToken' ]

node --input-type=module -e "import('@wyrhta/core/household').then(m=>console.log(Object.keys(m)))"
→ [ 'household', 'listMembers', 'seedHousehold', 'setRole' ]
```

Confirmed: the identity module exports the enum as **`userRole`**, not `roleEnum`. The brief's
`roleEnum` reference was corrected in both schema barrels per the task instructions.

## Files created

- `src/db/schema/index.ts` — runtime barrel (`.js`-suffixed imports), re-exports
  `users`, `apiKeys`, `userRole` from `@wyrhta/core/identity` and `household` from
  `@wyrhta/core/household`. Comment placeholders left for future module tables
  (household, calendar, meals, feoh).
- `src/db/schema/drizzle-schema.ts` — identical re-exports, CJS-safe (no `.js` extensions),
  consumed by drizzle-kit.
- `src/db/index.ts` — Drizzle Postgres client: `postgres(config.databaseUrl, { max: config.dbPoolMax })`
  wrapped by `drizzle(...)` with the schema barrel attached; exports `db` and `DB` type.
- `tests/setup.ts` — sets required env defaults (only if unset), then dynamically imports
  the migrator, `db`, and `sql`; `beforeAll` runs `migrate()` against
  `./src/db/migrations`; `beforeEach` truncates all public tables (except
  `__drizzle_migrations`) via a `DO $$ ... CASCADE` loop.

Transcribed verbatim from the brief except for the `roleEnum` → `userRole` correction in
`src/db/schema/index.ts` and `src/db/schema/drizzle-schema.ts`.

## Typecheck result

```
set -a && source .env && set +a && npm run typecheck
> heorth@0.1.0 typecheck
> tsc --noEmit
```

Clean, no errors, no output.

## Git integrity

- Commit: `c8060292dab60bc2a9c66d6539d2c8adec8ff115` — "feat: add Drizzle client, core-aware schema barrels, and test harness"
- `git status --short` after commit: clean for tracked task files (only pre-existing untracked
  `.superpowers/` directory remains, unrelated to this task — not part of Task 0.3's deliverables).
- `git show --stat HEAD` lists exactly the 4 expected files:
  `src/db/index.ts`, `src/db/schema/drizzle-schema.ts`, `src/db/schema/index.ts`, `tests/setup.ts`.
- `git show HEAD:src/db/schema/index.ts | grep -c userRole` → `1`
- `git show HEAD:src/db/schema/index.ts | grep -c roleEnum` → `0`
- Same pattern verified in `drizzle-schema.ts` (visually inspected, both re-export `userRole`,
  no `roleEnum` reference).

No `Co-Authored-By` trailer was added, per instructions.

## Concerns

- As expected per the task brief, `npm test` was **not** run to a full pass in this task —
  there are no migrations generated yet (no `src/db/migrations` directory) and no test files
  exercise the DB. `tests/setup.ts` will fail at `beforeAll` (`migrate()`) until the first
  module's tables land and `db:generate`/`db:migrate` are run (Task 0.5+), which is expected
  and explicitly out of scope here.
- Line endings: git warned about LF→CRLF conversion warnings on Windows checkout for all four
  new files (repo's `.gitattributes`/core.autocrlf behavior) — cosmetic only, no action taken
  since this is standard behavior on this Windows checkout and not something this task's scope
  covers.
- `.superpowers/` appears as untracked in `git status` but was not touched or staged by this
  task; flagged for visibility only.

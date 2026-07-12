# Task 0.2 Report: Env validation

## Files created
- `src/config/env.ts` — exports `buildEnvSchema()` (Zod schema factory: `DATABASE_URL` url, `JWT_SECRET` min 32 chars, `HOUSEHOLD_NAME` min 1, `ADMIN_EMAIL` email, `ADMIN_PASSWORD` min 1, `API_PORT`/`JWT_TTL_SECONDS`/`DB_POOL_MAX` coerced positive ints with defaults, `CORS_ORIGIN` string default `'*'`) and `config` (const, built from `safeParse(process.env)` at import time, `process.exit(1)` + console.error on failure). Transcribed verbatim from the brief.
- `tests/env.test.ts` — 4 tests against `buildEnvSchema()`: accepts valid env, rejects short `JWT_SECRET`, rejects missing `HOUSEHOLD_NAME`, rejects invalid `ADMIN_EMAIL`. Transcribed verbatim from the brief.

## TDD cycle
- **RED (real):** Wrote `tests/env.test.ts` first, pointing at `../src/config/env.js` before `src/config/env.ts` existed. Confirmed genuine RED: `Cannot find module '../src/config/env.js'`.
- Blocker encountered: `vitest.config.ts` (from Task 0.1) has a required `setupFiles: ['./tests/setup.ts']` entry; that file is Task 0.3's deliverable and does not exist yet. Without it, `vitest run` fails immediately at config-load time with "Cannot find module '.../tests/setup.ts'" for *any* test file, masking the real RED reason. To get an accurate RED/GREEN signal I created a **temporary, uncommitted** `tests/setup.ts` stub (`export {};`), ran the RED/GREEN cycle, then **deleted it** before staging/committing. It is not part of this task's file set and is not present in the final commit or working tree.
- **GREEN:** After creating `src/config/env.ts`, `npm test -- tests/env.test.ts` → `1 passed (1)`, `4 passed (4)`.

## Test environment note
The gitignored `.env`'s `HOUSEHOLD_NAME=Test Household` value was unquoted, which broke `set -a && source .env && set +a` (bash split on the space, then tried to run `Household` as a command). Fixed by quoting the value in `.env` (`HOUSEHOLD_NAME="Test Household"`) — this file is gitignored/local-only, not part of any commit, so no repo-visible change resulted. Flagging in case other tasks source `.env` the same way and hit the same issue with other spaced values.

## Verification commands run
- `npm test -- tests/env.test.ts` → PASS, 4/4 tests (Test Files 1 passed, Tests 4 passed).
- `npm run typecheck` (with sourced `.env`) → clean, no output/errors, exit success.

## Git integrity checks
- `git status` → clean (only pre-existing untracked `.superpowers/`, unrelated to this task).
- `git show --stat HEAD` → exactly `src/config/env.ts` (35 insertions) and `tests/env.test.ts` (37 insertions), 72 total insertions, 0 deletions.
- `git show HEAD:src/config/env.ts | grep -c buildEnvSchema` → `2` (function declaration + `export function` line match, and its call site `buildEnvSchema().safeParse(...)`).
- Commit SHA `04d6089f0080d7211b1d91602556b54bc932908c`, subject `feat: add Zod-validated env configuration` (per parent task instructions, which took precedence over the brief's own suggested message `feat: add Zod-validated env config extending core requirements`).
- No `Co-Authored-By` trailer (confirmed via `git log -1 --format='%H %s%n%b'` — body is empty).

## Concerns
- The `vitest.config.ts` → `tests/setup.ts` dependency (Task 0.1 → Task 0.3) means **no test file in this repo can currently run standalone** until Task 0.3 lands `tests/setup.ts` for real. This isn't a defect introduced by this task, but it's worth flagging to whoever picks up Task 0.3 next: until it's committed, `npm test` (with no args) will also fail at config-load for the same reason, so Task 0.3 should be prioritized before further test-writing tasks accumulate.
- No `.env`-file changes were committed (it's gitignored); the quoting fix is local-environment-only and won't propagate to other machines' `.env` files, but the brief's own example `.env` format (in Task 0.1's `.env.example`, presumably) should probably document quoting for multi-word values if not already doing so.
- Schema field `API_PORT` (env.ts) vs. the local `.env`'s `PORT` key: unrelated/harmless since `API_PORT` has a default (3000) and isn't required — just noting the naming mismatch exists in the test `.env` file, not something this task needed to fix.

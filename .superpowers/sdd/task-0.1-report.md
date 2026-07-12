# Task 0.1 Report: Project scaffolding & config files

## Files created
- `package.json` — npm scripts (dev, build, typecheck, db:generate/migrate/studio/push, test, docker:up/down/reset), dependencies incl. `@wyrhta/core` pinned to `github:Wyrhta-Labs/wyrhta-core#v0.1.1` (corrected per task instructions, brief's `wyrhta-labs/core#v0.1.0` ref was wrong).
- `tsconfig.json` — ES2022 target/module, bundler resolution, strict mode, src-rooted, excludes tests/dist/node_modules.
- `vitest.config.ts` — globals on, node environment, single-fork pool, setup file `./tests/setup.ts` (not yet created — expected in a later task).
- `drizzle.config.ts` — schema at `./src/db/schema/drizzle-schema.ts`, migrations out to `./src/db/migrations`, postgresql dialect, DATABASE_URL from env with local fallback.
- `docker-compose.yml` — `api` (build from local Dockerfile, depends on healthy `db`) + `db` (postgres:16-alpine with healthcheck) services, `postgres_data` volume.
- `.env.example` — template with DATABASE_URL, JWT_SECRET, HOUSEHOLD_NAME, ADMIN_EMAIL/PASSWORD, API_PORT, JWT_TTL_SECONDS, CORS_ORIGIN, DB_POOL_MAX, POSTGRES_PASSWORD.
- `.gitignore` — node_modules/, dist/, web/dist/, .env, *.log, plus the required negation `!src/db/migrations/*.sql` (with comment) to force-track Drizzle migration SQL against the global `core.excludesFile` `*.sql` rule.
- `Dockerfile` — node:22-alpine, npm ci, build + build:web, expose 3000, run dist/index.js.

All content transcribed verbatim from `.superpowers/sdd/task-0.1-brief.md` except the two corrections specified in the task instructions (dependency ref, .gitignore migrations negation).

## npm install result
Succeeded: "added 260 packages, and audited 261 packages in 1m". `@wyrhta/core@0.1.1` resolved correctly from GitHub. Output included:
- Deprecation warnings for `@esbuild-kit/esm-loader`/`@esbuild-kit/core-utils` (merged into tsx) and `glob@10.5.0` — transitive, benign.
- 6 vulnerabilities reported (4 moderate, 2 high) via `npm audit` — not addressed per task scope (out of scope for this scaffolding task).
- Expected "allow-scripts" warning for packages with install scripts not yet approved: `@wyrhta/core@0.1.1`, `argon2@0.41.1`, 4x `esbuild` variants. This matches the task's stated expectation and required no action.

`package-lock.json` was generated and committed.

## docker compose config result
Ran `docker compose config`. Exited cleanly (no hard error), printed the fully resolved compose file. Only warning: `POSTGRES_PASSWORD` variable not set, defaulting to blank string (printed twice, once per service referencing it) — this is the expected/documented warning since no `POSTGRES_PASSWORD` is exported in the shell env (the repo's real `.env` file also lacks it — only `docker compose up`, which we were told not to run, would source `.env` values into the container). Other vars (ADMIN_EMAIL, JWT_SECRET, HOUSEHOLD_NAME, ADMIN_PASSWORD) resolved from the local `.env` file since Docker Compose auto-reads `.env` in the project root; this is fine and doesn't affect validation. `docker compose up` was NOT run, per instructions (existing Postgres on host port 55432 is used for tests instead).

## Git integrity checks
- `git status` after commit: clean except untracked `.superpowers/` directory (pre-existing, not part of this task's file set, left untouched).
- `git show --stat HEAD`: lists exactly the 9 expected files — `.env.example`, `.gitignore`, `Dockerfile`, `docker-compose.yml`, `drizzle.config.ts`, `package-lock.json`, `package.json`, `tsconfig.json`, `vitest.config.ts`. 5701 insertions total (package-lock.json dominates at 5555 lines).
- `git show HEAD:package.json | grep wyrhta-core` → `"@wyrhta/core": "github:Wyrhta-Labs/wyrhta-core#v0.1.1",` — confirms correct org/repo/tag.
- Confirmed `.env` is NOT in the commit: `git ls-tree -r HEAD --name-only | grep -x "\.env"` returned no match (grep exit code 1).
- Commit SHA: `d87da4bd3d8f6bf23d68cdea5bd51bf0176580c7`, subject: `chore: scaffold Heorth project config and dependencies`. No Co-Authored-By trailer (confirmed by reading commit message — only the subject line).

## Self-review
- All 8 required files created, verbatim from brief except the 2 mandated corrections.
- CRLF line-ending warnings appeared during `git add` (repo's `core.autocrlf` config normalizes LF→CRLF on checkout) — this is a pre-existing repo/global git config behavior, not something introduced by this task; content itself was written with LF endings via the Write tool and git will handle normalization transparently. Not a concern.
- No stray `Co-Authored-By` trailer was added (per global CLAUDE.md instruction and per this task's explicit "NO Co-Authored-By trailer" directive).
- `.superpowers/` directory remains untracked/uncommitted, as expected — it's out of scope for this task (it's the docs/brief location, not part of the file set to commit).

## Concerns
- None blocking. Minor notes:
  - `npm audit` reports 6 vulnerabilities (4 moderate, 2 high) in transitive deps; not remediated here as it's outside this scaffolding task's scope — flagging for awareness in case a later task wants to address it.
  - `vitest.config.ts` references `./tests/setup.ts`, which does not exist yet — expected, to be created in a later task per the 0.1 plan.
  - `drizzle.config.ts` references `./src/db/schema/drizzle-schema.ts`, which also does not exist yet — expected, later task.

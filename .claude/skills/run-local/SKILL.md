---
name: run-local
description: Use when asked to run, start, restart, rebuild, or smoke-test Heorth locally for manual testing — Vite web UI on 5173 against the Wyrhta dev stack, rebuilding the Heorth dev container from this checkout, running the web or server test suites, or logging in to the dev instance. For the stack itself (bring-up, ports, KithLedger, Firefly) the meta repo's wyrhta-dev-env skill is the source of truth.
---

# Run Heorth locally

Heorth runs against the **Wyrhta dev stack** (`deploy/compose.dev.yml` in the
meta repo, one directory up from this repo). Bring-up, ports, databases and
troubleshooting live in the meta repo — read
`../.agents/skills/wyrhta-dev-env/SKILL.md` and `../deploy/README.md` instead of
this page for anything about the stack itself. This page covers only what you do
*from the Heorth checkout*.

What the stack gives you (from the meta skill; check it if in doubt):

| | |
|---|---|
| Heorth API + built web bundle | `http://localhost:14000` (container `wyrhta-dev-heorth-1`) |
| Dev Postgres `db` | `localhost:15432`, database `heorth_dev` (durable dev data) |
| Test Postgres `db-test` | `127.0.0.1:15433`, database `heorth_test` (tmpfs, disposable) |

All `docker compose` commands below run **from the meta repo root** (`..`) and
use `-f deploy/compose.dev.yml --env-file deploy/.env`. If the stack is down,
bring it up with `deploy/dev-up.sh` (meta repo), do not hand-roll it.

## 0. Look before you start

```bash
docker ps --format '{{.Names}}\t{{.Ports}}\t{{.Status}}'
curl -s http://localhost:14000/health     # {"data":{"status":"ok"},"meta":{}}
```

The liveness route is **`/health`, unversioned** — there is no
`/api/v1/health`, and Vite does not proxy `/health` (only `/api`). Nothing
listens on 3000 or 4000: 3000 is container-internal.

## 1. Web change: Vite on 5173 against the stack

`web/vite.config.ts` proxies `/api` to `http://localhost:14000`, so the stack's
container is the backend; nothing to start on the API side.

```bash
( cd web && npx vite --port 5173 --strictPort ) &> "$SCRATCH/heorth-web.log" &
```

Vite's first start can take 10+ seconds; ready line `Local: http://localhost:5173/`.
Then run the smoke test (§5) or open http://localhost:5173.

Stop by PID, not by name (Git Bash `pkill -f` is unreliable here):

```bash
powershell -c "Get-NetTCPConnection -State Listen -LocalPort 5173 -ea 0 | select -Expand OwningProcess"
powershell -c "Stop-Process -Id <pid> -Force"
# verify free: the same Get-NetTCPConnection line prints nothing
```

(`netstat` prints German state names — `ABHÖREN` — so don't grep for `LISTENING`.)

## 2. API / backend change: rebuild the container

Source edits do not reach the container (`build: ../Heorth`, no bind mounts).
From the meta repo root:

```bash
docker compose -f deploy/compose.dev.yml --env-file deploy/.env up -d --build --wait heorth
curl -s http://localhost:14000/health
```

~1-2 minutes; `--wait` returns when the container is healthy. This also bakes
in the web bundle served on :14000, so web changes show there after a rebuild
too (Vite on 5173 is the hot-reload path for those).

## 3. Optional: run the API from source (hot reload)

Works, but replaces the container on 14000 — only when a rebuild per edit is too
slow. **Do not use the repo's own `.env` as-is**: it is a stale pre-compose file
(`API_PORT=4000`, `localhost:5432`, a Postgres that is not the stack's). The `.env`
auto-loader never overrides exported variables, so export the stack's values
instead (passwords read from `deploy/.env`, never echoed). From the Heorth repo:

```bash
docker compose -f ../deploy/compose.dev.yml --env-file ../deploy/.env stop heorth
set -a; . <(grep -E '^(HEORTH_DB_PASSWORD|HEORTH_JWT_SECRET|HEORTH_ADMIN_EMAIL|HEORTH_ADMIN_PASSWORD|HOUSEHOLD_NAME)=' ../deploy/.env | tr -d '\r'); set +a
export DATABASE_URL="postgres://heorth:${HEORTH_DB_PASSWORD}@127.0.0.1:15432/heorth_dev" \
       JWT_SECRET="$HEORTH_JWT_SECRET" ADMIN_EMAIL="$HEORTH_ADMIN_EMAIL" \
       ADMIN_PASSWORD="$HEORTH_ADMIN_PASSWORD" API_PORT=14000
npx tsx watch src/index.ts &> "$SCRATCH/heorth-api.log" &     # = npm run dev
```

Ready line: `Heorth running on http://localhost:14000`. Port stays **14000** because the
Vite proxy is hardcoded to it. It runs against the real `heorth_dev` data. To go
back: stop the node process by PID (see §1) and
`docker compose -f ../deploy/compose.dev.yml --env-file ../deploy/.env up -d --wait heorth`.
Optional integrations (M365, Google, Kith, Firefly, Gewrit) stay off unless you
also export their variables from `deploy/.env`.

## 4. Tests

Never against the dev cluster (15432): the suite truncates every table, and
`tests/setup.ts` only accepts database names ending in `_test`. Use `db-test` on
**`127.0.0.1:15433`** (never `localhost` — on Windows it resolves to `::1`
and stalls with `CONNECT_TIMEOUT`). It is part of the normal stack `up`; if it
is down: `docker compose -f deploy/compose.dev.yml --env-file deploy/.env up -d --wait db-test`.

```bash
# server suite, from the Heorth repo (~2.5 min, 99 files)
set -a; . <(grep -E '^HEORTH_DB_PASSWORD=' ../deploy/.env | tr -d '\r'); set +a
export DATABASE_URL="postgres://heorth:${HEORTH_DB_PASSWORD}@127.0.0.1:15433/heorth_test"
npx vitest run

# web suite, from web/ (~40 s, needs no database)
cd web && npx vitest run
```

Without the dev stack, the throwaway-container command in `README.md` → Testing
works the same way. `tests/setup.ts` runs the migrations itself.

## 5. Smoke test and logging in

```bash
bash .claude/skills/run-local/smoke.sh        # Vite must be up on 5173
bash .claude/skills/run-local/smoke.sh 14000  # or point it at the container directly
```

Logs in through web -> proxy -> API -> Postgres and checks for a JWT; exit 0 =
healthy. It reads the maintenance admin itself (`HEORTH_ADMIN_EMAIL` /
`HEORTH_ADMIN_PASSWORD` in the meta repo's git-ignored `deploy/.env`); override
with `smoke.sh [WEB_PORT] [EMAIL] [PASSWORD]`.

Login is `POST /api/v1/auth/token` with `{"email","password"}`. For the UI:

- The **maintenance admin** from `deploy/.env` authenticates but is not a
  household member — don't judge content visibility with it.
- Household members: the dev household's real members, or the `@demo.invalid`
  sample members after `node deploy/seed-dev.mjs` (see `../deploy/README.md`,
  "seed the dev stack"; member password convention in `deploy/seed-demo.mjs`).
  The seeded *demo* instance is a different stack on 24000, not this one.

Never copy a password into this file, a commit, or the transcript.

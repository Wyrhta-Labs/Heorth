---
name: run-local
description: Use when asked to run, start, launch, restart, or smoke-test Heorth locally (API + web UI) for manual testing.
---

# Run Heorth locally

Heorth is a Hono API (`tsx`/Node) plus a Vite + React web UI in `web/`. There
are **two** ways it runs locally, and they collide on port 4000. Work out which
one you want *before* starting anything.

| | API | Web UI | DB | Picks up source edits? |
|---|---|---|---|---|
| **A. Compose stack** (usually already up) | `wyrhta-dev-heorth-1` container, host **4000** | built bundle, same port | `wyrhta-dev-db-1` :5432 `heorth_dev` | No — baked image, needs a rebuild |
| **B. Local processes** | `tsx` on **4000** (repo `.env`) | Vite on **5173** | whatever the repo `.env` points at | Yes |

Vite proxies `/api` → `http://localhost:4000` (hardcoded in
`web/vite.config.ts`), so **Vite on 5173 works against either API** — the
compose container or a local `tsx`, whichever holds 4000.

## 0. Look before you start

```bash
docker ps --format '{{.Names}}\t{{.Ports}}\t{{.Status}}'
```

`wyrhta-dev-heorth-1  0.0.0.0:4000->3000/tcp` means the compose API is already
serving. **Do not check port 3000** — nothing listens there; the container's
`API_PORT=3000` is internal only, published as 4000. To see local processes:

```bash
powershell -c "Get-NetTCPConnection -State Listen -LocalPort 4000,5173 -ea 0 | select LocalPort,OwningProcess"
```

## 1. Common case: a web-only change

The compose container already serves the API, so **start Vite only** — there is
nothing to restart on the API side.

```bash
( cd web && npx vite --port 5173 --strictPort ) &> "$SCRATCH/heorth-web.log" &
```

Ready line: `Local:   http://localhost:5173/`. Then verify (§4).

## 2. API / backend change

Source edits do **not** reach the container (`build: ../Heorth`, no bind
mounts). Either rebuild it:

```bash
docker compose -f ../deploy/compose.dev.yml up -d --build heorth   # ~image rebuild
```

…or take port 4000 over with a local process, which is faster to iterate on.
`.env` is **not** auto-loaded (no dotenv / `--env-file` in the package scripts),
so pass `--env-file` explicitly:

```bash
docker compose -f ../deploy/compose.dev.yml stop heorth   # free port 4000 first
npx tsx --env-file=.env src/index.ts &> "$SCRATCH/heorth-api.log" &
```

Ready line: `Heorth running on http://localhost:4000`. Skipping the `stop` gives
`Error: listen EADDRINUSE: address already in use :::4000`.

Keep the local API on **4000**: `web/vite.config.ts` hardcodes that proxy
target, so overriding `API_PORT` to dodge the container silently breaks the web
UI's `/api` calls.

Postgres for this path is whatever the repo `.env`'s `DATABASE_URL` names — a
container of your own, or the compose stack's `db`. If it is a container that is
stopped:

```bash
docker start <your-postgres-container>
docker exec <your-postgres-container> pg_isready
```

Migrations run and the admin is seeded on boot, so an empty DB self-populates.

## 3. Stop

```bash
pkill -f "vite --port 5173"
pkill -f "tsx --env-file=.env src/index.ts"
docker compose -f ../deploy/compose.dev.yml stop heorth    # only if you started it
```

Leave the compose stack alone unless you actually took port 4000 — it is the
default dev API and has usually been up for hours.

## 4. Verify (drive it, don't just launch)

```bash
bash .claude/skills/run-local/smoke.sh          # resolves admin creds itself
```

Logs in through web → Vite proxy → API → Postgres → seeded admin and checks for
a JWT. Exit 0 = the whole stack is healthy. The credentials **differ per path**
(see below), so let the script resolve them rather than passing guesses; to
override: `smoke.sh [WEB_PORT] [EMAIL] [PASSWORD]`.

Open http://localhost:5173 in a browser to click through the UI (title:
"Heorth"). The API's own liveness route is unversioned:
`curl http://localhost:4000/health` → `{"data":{"status":"ok"}}`.

## Environment

Login is `POST /api/v1/auth/token` with `{"email","password"}`. **The seeded
admin is not the same account on both paths** — this is the single most common
way a smoke test fails:

| | Compose container | Local `tsx` (repo `.env`) |
|---|---|---|
| `ADMIN_EMAIL` | from `deploy/.env` | from the repo `.env` |
| `ADMIN_PASSWORD` | from `deploy/.env` | from the repo `.env` |
| `DATABASE_URL` | `…@db:5432/heorth_dev` | whatever the repo `.env` points at |
| `API_PORT` | `3000` internal → **4000** published | **4000** |

Both sides are whatever *your* env files say — they are not the same account,
and neither is guessable, which is why `smoke.sh` resolves them at run time
instead of hardcoding a default.

Read the container's values with:

```bash
docker inspect wyrhta-dev-heorth-1 --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -E "ADMIN|DATABASE_URL"
```

`JWT_SECRET` (≥32 chars) lives in `.env` / `deploy/.env`. Never echo secrets
into the transcript beyond what a login needs.

## Neighbours on the dev stack

The same compose project also publishes `wyrhta-dev-kithledger-1` on **4002**
and `wyrhta-dev-db-1` on **5432**. The backend suite needs a **separate**
`heorth_test` database — `tests/setup.ts` refuses any DB whose name does not end
in `_test`, because it truncates every table between tests. Point `DATABASE_URL`
at a primary database and you will lose its contents.

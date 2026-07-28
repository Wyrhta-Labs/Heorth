---
name: run-local
description: Use when asked to run, start, launch, or smoke-test Heorth locally (API + web UI) for manual testing.
---

# Run Heorth locally

Heorth is a Hono API (`tsx`/Node) plus a Vite + React web UI in `web/`. Both
run against a shared Postgres. The web dev server proxies `/api` → the API.

## 1. Postgres (shared `kith-testdb`)

Both Heorth and KithLedger use one Postgres container on host port **55432**
(user `kith` / `kithpw`, databases `heorth` and `kithledger`). The API's
`.env` `DATABASE_URL` already points at it.

```bash
docker info >/dev/null 2>&1 || {              # Docker Desktop down? start it and wait
  "/c/Program Files/Docker/Docker/Docker Desktop.exe" &
  for i in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 5; done
}
docker start kith-testdb                        # container already exists & is seeded
docker exec kith-testdb pg_isready -U kith      # → accepting connections
```

If `kith-testdb` doesn't exist, create it:
`docker run -d --name kith-testdb -e POSTGRES_USER=kith -e POSTGRES_PASSWORD=kithpw -e POSTGRES_DB=heorth -p 55432:5432 postgres:18-alpine`
then `docker exec kith-testdb createdb -U kith kithledger`. The app runs
migrations + seeds the admin on boot, so an empty DB self-populates.

## 2. Run (background)

`.env` is **not** auto-loaded (no dotenv / `--env-file` in package scripts), so
pass `--env-file` explicitly. Non-watch keeps logs clean:

```bash
# API on :3000
npx tsx --env-file=.env src/index.ts &> /tmp/heorth-api.log &
# web on :5173 (Vite proxies /api → localhost:3000, config unchanged)
( cd web && npx vite --port 5173 --strictPort ) &> /tmp/heorth-web.log &
```

Ready line in the API log: `Heorth running on http://localhost:3000`.

## 3. Verify (drive it, don't just launch)

```bash
bash .claude/skills/run-local/smoke.sh 5173 admin@heorth.local admin-test-password
```

Exercises web → Vite proxy → API → Postgres → seeded admin by logging in and
checking for a JWT. Exit 0 = the whole stack is healthy. Open
http://localhost:5173 in a browser to click through the UI (title: "Heorth").

## 4. Stop

```bash
pkill -f "tsx --env-file=.env src/index.ts"
pkill -f "vite --port 5173"
```

## Environment

Admin/login come from `.env`. Login: `POST /api/v1/auth/token` with
`{"email","password"}`.

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | `postgres://kith:kithpw@localhost:55432/heorth` | shared `kith-testdb` |
| `API_PORT` | `3000` | override to run beside another instance |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | `admin@heorth.local` / `admin-test-password` | seeded on boot |
| `JWT_SECRET` | (in `.env`) | ≥32 chars |

## Running alongside KithLedger

Heorth keeps the defaults (API 3000, web 5173). See KithLedger's own
`run-local` skill — it moves to API 3001 / web 5174 to avoid the clash.

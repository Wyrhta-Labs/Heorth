#!/usr/bin/env bash
# Smoke-test the Wyrhta dev stack through Vite's /api proxy (web -> proxy -> API -> DB).
#
# Usage: smoke.sh [WEB_PORT] [ADMIN_EMAIL] [ADMIN_PASSWORD]
#
# Vite (default 5173) proxies /api to http://localhost:14000, the dev stack's
# Heorth. With no credentials passed, the maintenance admin is read from the
# repo-sibling deploy/.env (HEORTH_ADMIN_EMAIL / HEORTH_ADMIN_PASSWORD) or, as a
# fallback, from the running wyrhta-dev-heorth-1 container. Nothing is printed
# except the email.
set -euo pipefail
PORT="${1:-5173}"
EMAIL="${2:-}"
PASS="${3:-}"
BASE="http://localhost:${PORT}"
DEPLOY_ENV="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)/deploy/.env"
CONTAINER=wyrhta-dev-heorth-1

env_file_get() { sed -n "s/^${2}=//p" "$1" 2>/dev/null | tail -1 | tr -d '\r'; }

resolve_creds() {
  [ -n "$EMAIL" ] && [ -n "$PASS" ] && return
  if [ -f "$DEPLOY_ENV" ]; then
    EMAIL="${EMAIL:-$(env_file_get "$DEPLOY_ENV" HEORTH_ADMIN_EMAIL)}"
    PASS="${PASS:-$(env_file_get "$DEPLOY_ENV" HEORTH_ADMIN_PASSWORD)}"
    [ -n "$EMAIL" ] && [ -n "$PASS" ] && { echo "Resolved admin from deploy/.env."; return; }
  fi
  if [ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null)" = "true" ]; then
    local d
    d=$(docker inspect "$CONTAINER" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null || true)
    EMAIL="${EMAIL:-$(sed -n 's/^ADMIN_EMAIL=//p' <<<"$d" | tail -1)}"
    PASS="${PASS:-$(sed -n 's/^ADMIN_PASSWORD=//p' <<<"$d" | tail -1)}"
    [ -n "$EMAIL" ] && [ -n "$PASS" ] && { echo "Resolved admin from the ${CONTAINER} container."; return; }
  fi
  echo "FAIL: no admin credentials found (no deploy/.env, no ${CONTAINER})."
  echo "      Pass them: smoke.sh ${PORT} <email> <password>"
  exit 1
}

echo "Waiting for ${BASE} (Vite's first start can take ~15 s) ..."
code=000
for _ in $(seq 1 40); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/" || true)
  [ "$code" = "200" ] && break
  sleep 1
done
[ "$code" = "200" ] || { echo "FAIL: web not serving on ${BASE} (last=${code})"; exit 1; }

resolve_creds

echo "Logging in as ${EMAIL} through ${BASE}/api ..."
resp=$(curl -s -X POST "${BASE}/api/v1/auth/token" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASS}\"}")

if grep -q '"token"' <<<"$resp"; then
  echo "OK: web -> proxy -> Heorth :14000 -> Postgres healthy; login returned a JWT."
  exit 0
fi
echo "FAIL: no token in response: $resp"
echo "      UNAUTHORIZED: the credentials do not belong to the API on :14000;"
echo "      a refused connection / 5xx: the dev stack is down (see wyrhta-dev-env)."
exit 1

#!/usr/bin/env bash
# Smoke-test a running Heorth stack through its web (Vite proxy) port.
#
# Usage: smoke.sh [WEB_PORT] [ADMIN_EMAIL] [ADMIN_PASSWORD]
#
# The seeded admin differs depending on which API holds port 4000 — the
# wyrhta-dev-heorth-1 compose container or a local `tsx` run off the repo .env.
# With no credentials passed we resolve them from whichever is actually serving,
# because hardcoded defaults just produce a confusing UNAUTHORIZED.
set -euo pipefail
PORT="${1:-5173}"
EMAIL="${2:-}"
PASS="${3:-}"
BASE="http://localhost:${PORT}"
REPO_ENV="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)/.env"
CONTAINER=wyrhta-dev-heorth-1

# Read KEY=value from a file, ignoring comments. Value may contain '='.
env_file_get() { sed -n "s/^${2}=//p" "$1" 2>/dev/null | tail -1; }

resolve_creds() {
  [ -n "$EMAIL" ] && [ -n "$PASS" ] && { echo "Using credentials passed on the command line."; return; }

  # The container publishes 4000; if it is up it is what Vite proxies to.
  if [ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null)" = "true" ]; then
    local env_dump
    env_dump=$(docker inspect "$CONTAINER" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null || true)
    EMAIL="${EMAIL:-$(sed -n 's/^ADMIN_EMAIL=//p' <<<"$env_dump" | tail -1)}"
    PASS="${PASS:-$(sed -n 's/^ADMIN_PASSWORD=//p' <<<"$env_dump" | tail -1)}"
    [ -n "$EMAIL" ] && [ -n "$PASS" ] && { echo "Resolved admin from the ${CONTAINER} container."; return; }
  fi

  if [ -f "$REPO_ENV" ]; then
    EMAIL="${EMAIL:-$(env_file_get "$REPO_ENV" ADMIN_EMAIL)}"
    PASS="${PASS:-$(env_file_get "$REPO_ENV" ADMIN_PASSWORD)}"
    [ -n "$EMAIL" ] && [ -n "$PASS" ] && { echo "Resolved admin from ${REPO_ENV}."; return; }
  fi

  echo "FAIL: could not resolve admin credentials (no ${CONTAINER} container, no usable .env)."
  echo "      Pass them explicitly: smoke.sh ${PORT} <email> <password>"
  exit 1
}

echo "Waiting for web + API via ${BASE} ..."
for _ in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/" || true)
  [ "$code" = "200" ] && break
  sleep 1
done
[ "${code:-000}" = "200" ] || { echo "FAIL: web not serving on ${BASE} (last=${code:-000})"; exit 1; }

resolve_creds

echo "Logging in as ${EMAIL} (web -> proxy -> API -> DB -> seeded admin) ..."
resp=$(curl -s -X POST "${BASE}/api/v1/auth/token" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASS}\"}")

if grep -q '"token"' <<<"$resp"; then
  echo "OK: Heorth healthy — login returned a JWT."
  exit 0
fi
echo "FAIL: no token in response: $resp"
echo "      If this is UNAUTHORIZED, the API on :4000 is probably not the one"
echo "      these credentials belong to — see the skill's Environment table."
exit 1

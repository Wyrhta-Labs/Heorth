#!/usr/bin/env bash
# Smoke-test a running Heorth stack through its web (Vite proxy) port.
# Usage: smoke.sh [WEB_PORT] [ADMIN_EMAIL] [ADMIN_PASSWORD]
set -euo pipefail
PORT="${1:-5173}"
EMAIL="${2:-admin@heorth.local}"
PASS="${3:-admin-test-password}"
BASE="http://localhost:${PORT}"

echo "Waiting for web + API via ${BASE} ..."
for i in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/" || true)
  [ "$code" = "200" ] && break
  sleep 1
done
[ "${code:-000}" = "200" ] || { echo "FAIL: web not serving on ${BASE} (last=${code:-000})"; exit 1; }

echo "Logging in as ${EMAIL} (web -> proxy -> API -> DB -> seeded admin) ..."
resp=$(curl -s -X POST "${BASE}/api/v1/auth/token" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASS}\"}")

echo "$resp" | grep -q '"token"' \
  && { echo "OK: Heorth healthy — login returned a JWT."; exit 0; } \
  || { echo "FAIL: no token in response: $resp"; exit 1; }

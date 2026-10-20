#!/usr/bin/env bash
# CONTROLLER-SIDE. Kanboard ships a default administrator (admin/admin) and asks
# for it to be changed. Reset the password through the product's own CLI, then
# confirm the JSON-RPC endpoint answers to a genuine call so the negative control
# measures "RCX could not reflect this contract", not "the app refused our key".
# Password is never printed; auth.json is not uploaded.
set -uo pipefail
R="$1"
: "${PROBE_ADMIN_PASSWORD:?PROBE_ADMIN_PASSWORD must be set by the workflow}"
BASE=http://127.0.0.1:8014

docker compose -f "$R/compose.yaml" exec -T kanboard \
  /var/www/app/cli user reset-password --username admin --password "$PROBE_ADMIN_PASSWORD" \
  2>&1 | sed "s/$PROBE_ADMIN_PASSWORD/<redacted>/g" || echo "cli reset-password unavailable; default credential may still apply"

code=$(curl -s -o /tmp/kb.json -w '%{http_code}' --max-time 25 -X POST "$BASE/jsonrpc.php" \
  -u "admin:$PROBE_ADMIN_PASSWORD" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","method":"getVersion","id":1}')
echo "JSON-RPC getVersion -> HTTP $code"
node -e 'const j=require("/tmp/kb.json");console.log("JSON-RPC replied:",JSON.stringify(j.result??j.error).slice(0,120))' 2>/dev/null || echo "non-JSON reply"

B64=$(printf 'admin:%s' "$PROBE_ADMIN_PASSWORD" | base64 -w0)
printf '{"%s": "Basic %s"}\n' "$BASE" "$B64" > "$R/auth.json"
echo "wrote auth.json: HTTP Basic credential pinned to origin $BASE"

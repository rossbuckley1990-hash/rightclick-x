#!/usr/bin/env bash
# CONTROLLER-SIDE. Vikunja's API is bearer-token authenticated. Create the
# account with the product's own CLI, then log in through its own token endpoint
# and pin the resulting JWT to the origin. Neither password nor token is printed;
# auth.json is not uploaded.
set -uo pipefail
R="$1"
: "${PROBE_ADMIN_PASSWORD:?PROBE_ADMIN_PASSWORD must be set by the workflow}"
BASE=http://127.0.0.1:8011
SVC=$(docker compose -f "$R/compose.yaml" ps --services | head -1)

docker compose -f "$R/compose.yaml" exec -T "$SVC" \
  /app/vikunja/vikunja user create --username admin --password "$PROBE_ADMIN_PASSWORD" \
  --email admin@example.test 2>&1 | sed "s/$PROBE_ADMIN_PASSWORD/<redacted>/g" \
  || echo "cli user create unavailable"

tok=$(curl -s --max-time 25 -X POST "$BASE/api/v1/token" \
  -H 'content-type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$PROBE_ADMIN_PASSWORD\",\"totp_passcode\":\"\"}" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).token||"")}catch{process.stdout.write("")}})')

if [ -n "$tok" ]; then
  printf '{"%s": "Authorization Bearer %s"}\n' "$BASE" "$tok" > "$R/auth.json"
  echo "wrote auth.json: Vikunja JWT pinned to origin $BASE (token length ${#tok})"
else
  echo "login returned no token; probe runs unauthenticated"
fi

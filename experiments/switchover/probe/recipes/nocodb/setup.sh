#!/usr/bin/env bash
# CONTROLLER-SIDE. NocoDB serves its Swagger contract and GraphQL API only to a
# holder of an API token, so sign in and mint one. Endpoint paths differ between
# NocoDB releases; both are attempted and the outcome is recorded rather than
# assumed. Credentials are never printed and auth.json is not uploaded.
set -uo pipefail
R="$1"
B="http://127.0.0.1:8004"
EMAIL="admin@example.test"
: "${PROBE_ADMIN_PASSWORD:?PROBE_ADMIN_PASSWORD must be set by the workflow}"

JWT=$(curl -sf -X POST "$B/api/v1/auth/user/signin" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PROBE_ADMIN_PASSWORD\"}" | jq -r '.token // empty')

if [ -z "$JWT" ]; then
  echo "signin failed: no JWT returned; probing unauthenticated only"
  exit 0
fi
echo "signin succeeded (token length ${#JWT})"

# v2 per-base API token, then the older v1 global token endpoint.
API=$(curl -s -X POST "$B/api/v2/meta/apitokens" \
  -H "xc-auth: $JWT" -H 'content-type: application/json' \
  -d '{"title":"rcx-probe","description":"controller probe","permission":"data_api","enabled":true}' | jq -r '.token // empty')
ROUTE="api/v2/meta/apitokens"

if [ -z "$API" ]; then
  API=$(curl -s -X POST "$B/api/v1/tokens" \
    -H "xc-auth: $JWT" -H 'content-type: application/json' \
    -d '{"title":"rcx-probe","description":"controller probe","permission":"editor","enabled":true}' | jq -r '.token // empty')
  ROUTE="api/v1/tokens"
fi

if [ -n "$API" ]; then
  printf '{"http://127.0.0.1:8004": {"xc-token": "%s"}}\n' "$API" > "$R/auth.json"
  echo "wrote auth.json: xc-token pinned to origin http://127.0.0.1:8004 (minted via $ROUTE)"
else
  # Fall back to the session JWT so the probe can still see authenticated routes.
  printf '{"http://127.0.0.1:8004": {"xc-auth": "%s"}}\n' "$JWT" > "$R/auth.json"
  echo "wrote auth.json: session JWT fallback (no API token route answered)"
fi

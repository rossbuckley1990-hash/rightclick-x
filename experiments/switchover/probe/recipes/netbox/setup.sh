#!/usr/bin/env bash
# CONTROLLER-SIDE. NetBox creates the superuser from SUPERUSER_*, then mints API
# tokens. Ask the product for a token through its own REST API and pin it as a
# NetBox-recognised Authorization header. Nothing secret is printed.
set -uo pipefail
R="$1"
: "${PROBE_ADMIN_PASSWORD:?PROBE_ADMIN_PASSWORD must be set by the workflow}"
BASE=http://127.0.0.1:8012

# NetBox's session login is CSRF-protected; obtain the cookie jar first, then mint
# a token through /api/users/tokens/. This uses the product's documented API only.
JAR=$(mktemp)
trap 'rm -f "$JAR"' EXIT
csrf=$(curl -s -c "$JAR" --max-time 25 "$BASE/api/users/tokens/provision/" -o /dev/null -w '%{http_code}')
echo "warm-up GET -> HTTP $csrf"

tok=$(curl -s --max-time 30 -X POST "$BASE/api/users/tokens/" \
  -H 'content-type: application/json' -H "x-csrftoken: $(awk '$6=="csrftoken"{print $7}' "$JAR")" \
  -b "$JAR" -c "$JAR" -u "admin:$PROBE_ADMIN_PASSWORD" \
  -d '{"description":"probe"}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write(j.key||"")}catch{process.stdout.write("")}})')

if [ -n "$tok" ]; then
  printf '{"%s": "Authorization Token %s"}\n' "$BASE" "$tok" > "$R/auth.json"
  echo "wrote auth.json: NetBox API token pinned to origin $BASE"
else
  printf '{"%s": "Basic %s"}\n' "$BASE" "$(printf 'admin:%s' "$PROBE_ADMIN_PASSWORD" | base64 -w0)" > "$R/auth.json"
  echo "no token issued; wrote auth.json with HTTP Basic instead"
fi

#!/usr/bin/env bash
# CONTROLLER-SIDE. Papermerge seeds admin from PAPERMERGE__AUTH__*, but its v3 API
# authenticates with a scoped token rather than HTTP Basic. Create one through the
# product's own API and pin it. Neither password nor token is printed.
set -uo pipefail
R="$1"
: "${PROBE_ADMIN_PASSWORD:?PROBE_ADMIN_PASSWORD must be set by the workflow}"
BASE=http://127.0.0.1:8013

login=$(curl -s --max-time 30 -X POST -H 'content-type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$PROBE_ADMIN_PASSWORD\"}" \
  "$BASE/api/token/")
echo "$login" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log("POST /api/token/ -> keys:",Object.keys(j).join(","))}catch{console.log("POST /api/token/ -> non-JSON",s.slice(0,100))}})'

tok=$(echo "$login" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write(j.token||j.access||"")}catch{process.stdout.write("")}})')
if [ -n "$tok" ]; then
  printf '{"%s": "Authorization Bearer %s"}\n' "$BASE" "$tok" > "$R/auth.json"
  echo "wrote auth.json: bearer token pinned to origin $BASE"
else
  # Fall back to HTTP Basic so the probe still measures the surface, and record that.
  B64=$(printf 'admin:%s' "$PROBE_ADMIN_PASSWORD" | base64 -w0)
  printf '{"%s": "Basic %s"}\n' "$BASE" "$B64" > "$R/auth.json"
  echo "no token issued; wrote auth.json with HTTP Basic instead"
fi

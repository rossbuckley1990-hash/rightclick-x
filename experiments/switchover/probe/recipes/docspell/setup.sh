#!/usr/bin/env bash
# CONTROLLER-SIDE. Docspell's signup mode is open, so register a throwaway
# collective/user through the product's own public endpoint and keep the token it
# returns. The token is written into auth.json (never uploaded, never printed).
set -uo pipefail
R="$1"
: "${PROBE_ADMIN_PASSWORD:?PROBE_ADMIN_PASSWORD must be set by the workflow}"
BASE=http://127.0.0.1:7880

resp=$(curl -s --max-time 30 -X POST -H 'content-type: application/json' \
  -d "{\"coll\":\"probe\",\"user\":\"admin\",\"password\":\"$PROBE_ADMIN_PASSWORD\"}" \
  "$BASE/api/v1/open/signup/new")
# Echo only the outcome fields, never the credential material.
echo "$resp" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log("signup ->",j.success,j.message||"")}catch{console.log("signup -> non-JSON response",s.slice(0,120))}})'

tok=$(echo "$resp" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write(j.token||"")}catch{process.stdout.write("")}})')
if [ -n "$tok" ]; then
  printf '{"%s": "X-Docspell-Auth %s"}\n' "$BASE" "$tok" > "$R/auth.json"
  echo "wrote auth.json: Docspell token pinned to origin $BASE"
else
  echo "no token returned; probe will run unauthenticated"
fi

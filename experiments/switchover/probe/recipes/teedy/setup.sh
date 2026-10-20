#!/usr/bin/env bash
# CONTROLLER-SIDE. Teedy seeds its own admin account from DOCS_ADMIN_PASSWORD_INIT,
# so no database surgery is needed. This only verifies the credential actually
# works and pins it for the runtime's origin-scoped store. Password is never
# printed; auth.json is not uploaded as an artifact.
set -uo pipefail
R="$1"
: "${PROBE_ADMIN_PASSWORD:?PROBE_ADMIN_PASSWORD must be set by the workflow}"
BASE=http://127.0.0.1:8007

code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 \
  -u "admin:$PROBE_ADMIN_PASSWORD" "$BASE/api/app")
echo "GET /api/app with HTTP Basic -> HTTP $code"

if [ "$code" != "200" ]; then
  # Teedy also accepts its own session login; record whether that path works so
  # the difference between "no credential" and "credential not accepted" is known.
  login=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -X POST \
    -H 'content-type: application/json' \
    -d "{\"username\":\"admin\",\"password\":\"$PROBE_ADMIN_PASSWORD\"}" \
    "$BASE/api/user/login")
  echo "POST /api/user/login -> HTTP $login"
fi

B64=$(printf 'admin:%s' "$PROBE_ADMIN_PASSWORD" | base64 -w0)
printf '{"%s": "Basic %s"}\n' "$BASE" "$B64" > "$R/auth.json"
echo "wrote auth.json: HTTP Basic credential pinned to origin $BASE"

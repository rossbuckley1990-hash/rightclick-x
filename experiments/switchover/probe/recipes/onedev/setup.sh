#!/usr/bin/env bash
# CONTROLLER-SIDE. OneDev seeds its initial administrator from the container
# environment, so nothing needs to be created afterwards. Verify the credential
# against the live REST surface and pin it as HTTP Basic, which OneDev accepts.
# Password is never printed; auth.json is not uploaded.
set -uo pipefail
R="$1"
: "${PROBE_ADMIN_PASSWORD:?PROBE_ADMIN_PASSWORD must be set by the workflow}"
BASE=http://127.0.0.1:6610

for p in /~api/users/me /~api/projects; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 -u "admin:$PROBE_ADMIN_PASSWORD" "$BASE$p")
  echo "GET $p with HTTP Basic -> HTTP $code"
done

B64=$(printf 'admin:%s' "$PROBE_ADMIN_PASSWORD" | base64 -w0)
printf '{"%s": "Basic %s"}\n' "$BASE" "$B64" > "$R/auth.json"
echo "wrote auth.json: HTTP Basic credential pinned to origin $BASE"

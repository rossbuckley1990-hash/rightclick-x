#!/usr/bin/env bash
# CONTROLLER-SIDE. Grafana seeds its admin from GF_SECURITY_ADMIN_*. Verify the
# credential and pin it as HTTP Basic. Password is never printed; auth.json is
# not uploaded.
set -uo pipefail
R="$1"
: "${PROBE_ADMIN_PASSWORD:?PROBE_ADMIN_PASSWORD must be set by the workflow}"
BASE=http://127.0.0.1:3000

for p in /api/health /api/search /api/datasources; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -u "admin:$PROBE_ADMIN_PASSWORD" "$BASE$p")
  echo "GET $p with HTTP Basic -> HTTP $code"
done

B64=$(printf 'admin:%s' "$PROBE_ADMIN_PASSWORD" | base64 -w0)
printf '{"%s": "Basic %s"}\n' "$BASE" "$B64" > "$R/auth.json"
echo "wrote auth.json: HTTP Basic credential pinned to origin $BASE"

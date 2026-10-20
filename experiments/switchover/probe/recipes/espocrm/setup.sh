#!/usr/bin/env bash
# CONTROLLER-SIDE. EspoCRM's REST API accepts HTTP Basic for its admin user, so
# the runtime's origin-pinned credential store can reach it without any
# application-specific code. The password is never printed; auth.json is not
# uploaded as an artifact.
set -uo pipefail
R="$1"
: "${PROBE_ADMIN_PASSWORD:?PROBE_ADMIN_PASSWORD must be set by the workflow}"
B64=$(printf 'admin:%s' "$PROBE_ADMIN_PASSWORD" | base64 -w0)
printf '{"http://127.0.0.1:8002": "Basic %s"}\n' "$B64" > "$R/auth.json"
echo "wrote auth.json: HTTP Basic credential pinned to origin http://127.0.0.1:8002"

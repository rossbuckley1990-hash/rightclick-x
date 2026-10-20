#!/usr/bin/env bash
# CONTROLLER-SIDE. Writes the credential file the probe's origin-pinned store will
# use. The password comes from the job environment and is never printed; auth.json
# lives in the recipe directory, which is NOT uploaded as an artifact.
set -uo pipefail
R="$1"
: "${PROBE_ADMIN_PASSWORD:?PROBE_ADMIN_PASSWORD must be set by the workflow}"
B64=$(printf 'admin:%s' "$PROBE_ADMIN_PASSWORD" | base64 -w0)
printf '{"http://127.0.0.1:8001": "Basic %s"}\n' "$B64" > "$R/auth.json"
echo "wrote auth.json: HTTP Basic credential pinned to origin http://127.0.0.1:8001"

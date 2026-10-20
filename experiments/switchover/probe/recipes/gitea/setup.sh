#!/usr/bin/env bash
# CONTROLLER-SIDE. Creates the admin account through the application's own
# documented administration command, so the product is configured the way its
# vendor intends rather than by hand-editing its database. Password is never
# printed; auth.json is not uploaded.
set -uo pipefail
R="$1"
: "${PROBE_ADMIN_PASSWORD:?PROBE_ADMIN_PASSWORD must be set by the workflow}"

docker compose -f "$R/compose.yaml" exec -T gitea gitea admin user create \
  --username admin --password "$PROBE_ADMIN_PASSWORD" \
  --email admin@example.test --admin --must-change-password=false \
  2>&1 | sed "s/$PROBE_ADMIN_PASSWORD/<redacted>/g"

# Gitea's API accepts HTTP Basic, which the runtime's origin-pinned store can carry.
B64=$(printf 'admin:%s' "$PROBE_ADMIN_PASSWORD" | base64 -w0)
printf '{"http://127.0.0.1:8010": "Basic %s"}\n' "$B64" > "$R/auth.json"
echo "wrote auth.json: HTTP Basic credential pinned to origin http://127.0.0.1:8010"

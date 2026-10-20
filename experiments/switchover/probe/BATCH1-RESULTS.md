# Probe batch 1 — results and triage

Run: <https://github.com/rossbuckley1990-hash/rightclick-x/actions/runs/39347352056>
Runtime under test: commit `06321fa5632d3fd009d136d7b2dfe90510d8057d` (tag `switchover-freeze-1`),
asserted byte-identical for `src/`, `bin/` and `test/` by the workflow's own verification step.
Probed at: 2026-10-20T00:25Z (paperless) onward, `ubuntu-latest` GitHub-hosted runners, one
application per runner, no inbound exposure, per-job throwaway credentials.

## Why this file exists

Batch 1 reported "8 of 9 applications yielded nothing". That headline is **wrong**, and
recording it uncorrected would have been the same species of error as inventing success.
"0 capabilities" is ambiguous: it can mean the frozen baseline could not reflect a live
application (a genuine result about RightClick X), or that the application never started
(a defect in this harness, which says nothing about RightClick X at all). Batch 1 did not
distinguish the two. Triage of the boot logs and container listings does:

| Application    | Verdict | Evidence |
| -------------- | ------- | -------- |
| paperless-ngx  | **REFLECTED** — 2 providers, 164 capabilities | `/api/schema/` HTTP 200, OpenAPI 3, 163 operations in 705ms |
| corteza        | **GENUINE NEGATIVE** — booted, answered, 0 capabilities | server healthy; `/` HTTP 200; every `/api/*` path HTTP 404; no machine-readable contract served |
| espocrm        | **INVALID** — credential was never real | `setup.sh` only wrote `auth.json`; it never ran EspoCRM's installer, so the Basic credential named a user that did not exist → HTTP 401 on all 4 authenticated probes |
| wikijs         | **INVALID** — setup wizard never completed | containers healthy, `/graphql` HTTP 200, but introspection is refused until the install wizard finishes |
| zammad         | **GENUINE NEGATIVE** (+ one runtime defect) | 10 containers healthy; `/api/v1/signshow` 200; `/api/v1/tickets` 403; no OpenAPI served. RCX also emitted a spurious `mcp:127-0-0-1-8080-graphql` provider with **0 capabilities** — a false positive in MCP detection |
| chatwoot       | **HARNESS DEFECT** — app never started | only `db` and `redis` were up; `web` crashed, `db` logged `FATAL: database "chatwoot" does not exist` — migrations never ran and `SECRET_KEY_BASE` was absent |
| nocodb         | **HARNESS DEFECT** — app never started | `[ExceptionHandler] Error: Meta database configuration missing SQLite file name`; `NC_DB` used a `sqlite3://` scheme with a non-data path |
| teedy          | **HARNESS DEFECT** — image does not exist | `pull access denied for teedy/teedy`; the published image is `sismics/docs` |
| twenty         | **HARNESS DEFECT** — image does not exist | `pull access denied for twentyhq/twenty`; the published image is `twentycrm/twenty` |

**Corrected batch-1 conclusion: of 9 applications, 4 never started because of defects in
this harness, 2 were provisioned incompletely, 2 booted and answered but yielded no
capability, and 1 (Paperless-ngx) reflected cleanly with 163 typed operations.**

Batch 1 therefore establishes one viable application, not nine. It also establishes
nothing about the other eight, and they must be re-probed rather than written off.

## Defects fixed for batch 2

- `teedy` → `sismics/docs:latest`, with `DOCS_ADMIN_PASSWORD_INIT` so the product seeds
  its own administrator, plus a `setup.sh` that *verifies* the credential before pinning it.
- `twenty` → `twentycrm/twenty:latest`, with `PG_DATABASE_URL` instead of the split
  `PG_DATABASE_*` variables the image does not read.
- `nocodb` → Postgres meta database via `NC_DB=pg://…`, removing the filesystem path from
  the failure mode entirely.
- `setup.sh` files now **verify** credentials against a live endpoint and record the HTTP
  status, so "no credential" and "credential rejected" are distinguishable in the evidence.
- Workflow gained two steps: `Record exact image identities` (every image by digest —
  `latest` is a moving tag, so without this a re-run could silently measure different
  software) and `Triage` (the boot-vs-reflect classification above, emitted per job).

## Applications added to the pool

Chosen for domain overlap, because the switchover test needs a *replacement*, not an
arbitrary second product:

- **Document domain** (Paperless-ngx's domain): `teedy`, `docspell`, `mayan`, `papermerge`.
  Four independent products, so a replacement candidate is selected from real alternatives.
- **Issue/asset domain**: `gitea` (OpenAPI), `onedev`, `vikunja`, `netbox` (DRF, so likely
  to serve drf-spectacular like Paperless does).
- **Witness-host candidates**: `netbox`, `grafana`, `gitea` — deliberately from a *different*
  domain than the primary application, because an outcome witness that sits on the replaced
  product would fail every replay and prove nothing (see Phase 1 finding 4).
- **GraphQL axis**: `twenty`.
- **Negative control**: `kanboard` — a real product whose only machine interface is
  JSON-RPC 2.0, which the frozen baseline has no reflector for. A pool in which every
  application succeeds would not discriminate anything.

## Deferred to batch 3

`chatwoot` (needs `rails db:chatwoot_prepare` + `SECRET_KEY_BASE`), `espocrm` (needs the
installer run via `ESPOCRM_ADMIN_*`), `wikijs` (needs the `/finalize` wizard completed and
an admin API key for introspection), `corteza` (needs confirmation of whether *any* served
contract exists).

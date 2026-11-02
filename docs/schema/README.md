# Capability graph schema — draft v0

`capability-graph.v0.json` is the exchange shape of a reflected capability graph: what every
reflector (OpenAPI, GraphQL, MCP, web, CLI, platform, peer, builtin, composite) lands
capabilities in, and what `exportGraph()` emits. It is extracted from `src/core/types.ts`
(the runtime is the reference implementation) and published as a standalone draft for
implementation feedback — the schema seed of the Phase 0 roadmap.

**Status: draft v0, not frozen.** Structural fields are faithful to the runtime; semantics
(port matching, identifier schemes, risk semantics) are documented in the runtime, not
constrained here. Expect additive change; nothing here gates anything yet. Comment in the
tracking issue (#38) with what breaks for you as an implementer or generator author.

## Validation evidence (2026-11-03, main @ 278d66c)

The schema was checked against two real runtime exports, not examples written to fit:

| Instance | Capabilities | Invoke kinds exercised | Result |
|---|---|---|---|
| Learned demo world (OpenAPI + GraphQL + MCP + web providers) | 27 | builtin, http, graphql, mcp | 0 errors |
| Same world after composing and publishing a verified goal | 29 | + composite, goal | 0 errors |

`cli`, `peer` and `platform` invokes are faithful transcriptions of the TypeScript types but
were not present in either export; they are covered by the runtime's own test suite and will
gain instance-level validation when a CLI-bearing graph is exported.

## Validating an export yourself

```sh
python3 -c "
import json
from jsonschema import Draft202012Validator
schema = json.load(open('docs/schema/capability-graph.v0.json'))
instance = json.load(open('your-export.json'))
print(list(Draft202012Validator(schema).iter_errors(instance)))
"
```

The runtime side: `rc.exportGraph()` (also served at `GET /api/graph`) emits this shape,
with one documented deviation — CLI `continuity` lineage is stripped on export because it is
local history, not portable authority.

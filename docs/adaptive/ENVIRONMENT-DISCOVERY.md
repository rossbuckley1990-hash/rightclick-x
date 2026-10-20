# Environment-native discovery: engineering checkpoint

**Programme PARTIAL; release NO-GO.** This implements an additive slice of the Universal, Environment-Native Capability Discovery mission on the existing Adaptive Capability Plane branch. It does not replace the Master Execution Specification, Actenon requirements, Living Challenge, holdout sizes or commercial thresholds.

Starting revision: **`bfdfe0307013750c189054079fc7e7aa9e2d2451`**. Environment product: **`bdc2ef4`**. Frozen candidate including the public reuse driver: **`3fa530bb67d7b70d11d8ead656bb4ddeff15d49b`**. Branch remains `programme/adaptive-capability-plane`; no merge, push, publication, deployment, model call or spending occurred in this checkpoint.

## Phase 0: actual architecture and other work

The engineering checkout is `/Users/ross/src/rightclick-x-adaptive`, not a showcase directory. The [worktree inventory and source pins](evidence/environment-discovery/phase0.json) record local main `2666ad2`, the separate discovery branch `6b22a59`, and the observed remote main `4d51590`. The remote commit was downloaded for comparison without updating a branch or checking it out. Its product remains the older `c27289e` baseline; its subsequent changes concern cloud/probe experiments. Local main contains a selectively imported discovery correction, while this programme contains the later semantic, authority, lifecycle and dashboard implementation.

The baseline native run on `bfdfe03` was **314/315, one failure, zero skips**: C2's memory allocation completed. Typecheck, proof and builds passed. The raw failure remains in [living-public evidence](evidence/living-public/native-final.log). The new work does not modify the sandbox or that test.

| Category | Source and evidence examined | Finding |
|---|---|---|
| A: implemented and demonstrated | `reflectors/`, `graph`, `types`, `semantics`, `planner`, `identities`, `verify`, runtime and thirteen tools; existing protocol/drift/security tests; prior open-world and federation records | OpenAPI, GraphQL, MCP, web, peer, platform and authorised CLI reflection already feed one graph. Nested ports, collection mapping, identifier observations, saved goals, predicates/witnesses, repair and withdrawal exist. Do not duplicate them. |
| B: implemented with limited generality | API catalogs, public directories, learned identifiers, source inspection and healing | Catalog discovery previously required an agent-supplied front door; research did not refresh a configured environment or retain source observations. Identifier co-acceptance and lexical typing remain evidence-limited; they do not prove arbitrary identity. |
| C: supplied by a model/operator/harness | Existing public experiments, including citation development | Source URLs, desired outcomes, predicates and some anchors were supplied externally. The runtime did not discover the whole host or independently invent a business oracle. Previous cross-cloud trials included controlled services and manually selected inputs. |
| D: missing | HTTP execution, host discovery, independent evaluation | No generic persisted asynchronous continuation/polling mechanism. Ordinary HTTP execution still treats 2xx as transport success; this requires an explicit pending-result correction before an asynchronous claim. No DNS-SD, gRPC/A2A/Kafka/WASM discovery adapters, universal URL-to-nominal-ID proof, arbitrary shell visibility, or sealed independent-author evaluation. |

The existing open-world report and its preserved failures were reviewed; those exposed targets are not new holdouts. The remote probe triage distinguishes failed application setup from failed reflection and reports a false empty MCP detection; the imported transport correction now requires a genuine matching RPC response and a tools array. No specifically named SBOM or SilentProbe evidence file was found in the inspected engineering trees. Those named historical cases remain an evidence-retrieval gap, not claimed reproduced regressions.

The audited [Actenon feasibility assessment](../north-star/evidence/ACTENON-INTEGRATION-FEASIBILITY.md) remains the authority design basis. No new grant, proof, cryptographic format or authority framework was added.

## Implementation and invariant

**Only an operator-approved advertisement can introduce an automatically learned environment source; learning cannot grant execution authority.**

`src/reflectors/environment.ts` validates host configuration and observes bounded JSON linksets. `context_research` refreshes those observations and routes supported contracts through the existing `learn` method. There is no new MCP tool or parallel execution engine. Each observation retains its catalog, source, relation, protocol family, observation time, parsed-document digest, status and provider IDs. Credentials are reported only as configured/absent; authentication is **unknown** and authority **not assessed**.

The first family follows `service-desc` OpenAPI contracts from JSON API catalogs. RFC 9727 defines API catalogs and their linkset representation; the implementation deliberately supports a subset. Item links and unsupported media types are observations, not executable integrations. [RFC 9727](https://www.rfc-editor.org/rfc/rfc9727.html)

Host configuration is optional:

```json
{
  "catalogs": ["https://environment.example/.well-known/api-catalog"],
  "origins": ["https://services.example"]
}
```

Pass it as `RuntimeOptions.environment`, or set `RCX_ENVIRONMENT` to this JSON for the existing CLI/edge host. Run `node bin/rcx.ts research` or call `context_research`. No operation list, input mapping or provider-specific code is supplied. Startup and retained execution do not themselves scan; a research call is the explicit refresh point. Source-arrival detection latency therefore includes the interval until the next research call.

Controls and limits:

- At most eight catalogs, 64 advertisements per catalog, 128 underlying requests per refresh, 1 MiB per catalog and the existing 16 MiB per discovery response. Duplicate refreshes share one in-flight operation.
- Discovery scope intersects host egress policy, including redirects. Only GET/HEAD are dispatched by this adapter. No credential harvesting, executable installation, port scanning or speculative protocol POST occurs.
- Credential-bearing, query-bearing, fragment and non-HTTP(S) source URLs are rejected; unsafe URLs are not copied into observation evidence. These restrictions exclude some legitimate interfaces.
- Private-address rules remain in force. Local/private catalogs require an explicit suitable host network policy; the catalog does not relax that policy.
- A valid catalog removing a source withdraws only catalog-owned providers. Explicitly learned providers survive. Overlapping catalogs retain a source while another current or temporarily unobservable advertisement remains.
- Authentication failure, forbidden access, rate limiting, unavailable catalog and invalid/oversized catalog are distinct observations. They do not prove removal. Historical sources become stale; a stale catalog alone does not revoke an independently configured execution permission.
- Compatible refresh uses existing contract/operation-identity handling. Changed meaning remains refused under the retained identifier. No approval is transferred to a newly discovered operation.

Persisted observations are history, not host configuration or authority. No global TTL/background service is introduced. Existing saved goals that predate stored `require` terms cannot retroactively recover criteria that were never retained.

## Reused engineering and tests

`f4debae` imports the four verified transport files and two regression files from `6b22a59`, plus the conservative MCP destructive-hint precedence from `ca845e0`. This is a selective source reuse on the existing branch, not a Git merge. It prevents indefinite body/stream acquisition within the exercised request deadlines, rejects malformed/mismatched MCP responses, and retains GraphQL fallback. The existing bounded YAML reader was already present. No package dependency was added.

| Verification | Result |
|---|---|
| Seven initial environment tests on the transport-only baseline | **0/7**; missing environment path, preserved |
| Initial implementation | **7/7**; typecheck found one implicit-any in the test, preserved and corrected |
| Expanded discovery/identity/interface/lifecycle regression set | **64/64** |
| Frozen native complete suite | **351/351**, zero skipped; 31.164 s runner duration |
| Frozen Linux focused set, cached image, no network | **62/62**, zero skipped |
| Type checking and Node/edge builds | **PASS** |
| Black-box lifecycle proof | **28/28** |
| Exposed CLI inference migration/lifecycle replay | **19/19**, no unmet requirements; seven lifecycle and five continuity corruption controls rejected |
| Actenon lifecycle replay and separate native-proof checker | **23/23**, checker PASS; earlier bounded fixture limitations unchanged |
| Public citation capability, fresh process/new input | **PASS** for separate DOI/title/publisher readback; two requests, zero discovery; see [public result](LIVING-PUBLIC.md) |

The original CLI checker first failed because it expected version 25 rather than frozen version 27. Both raw checkers now accept an explicitly selected expected version and check it against the frozen source; default 25 is preserved. Wrong-version controls were added. Both checkers also pass the original version-25 evidence. No outputs, authority conditions, refusal counts or corruption requirements were relaxed. The first export command also failed because it named a nonexistent tracked `packages` path; no tests ran in that attempt.

The environment tests exercise actual runtime/graph/planner/executor/persistence code with controlled fetch transports. They cover a two-provider forecast/translation goal, restart reuse, a different-input compatible-change invocation, changed meaning, removal, overlapping advertisements, denied mutations, credential-bearing links, redirects, host-policy intersection, unsupported protocols and catalog failures. Their expected business responses are authored fixtures, not independent software or business attestation. They establish a generic runtime path, not the final unfamiliar-software milestone.

Full evidence: [environment directory](evidence/environment-discovery/), [manifest](evidence/environment-discovery-verification.json). The verifier and separate Python readbacks share the implementation author. Independent-author review is **not established**.

## Acceptance against the new mission

| Phase / required path | Status | Exact remaining scope |
|---|---|---|
| 0 reconstruction | PARTIAL | Engineering/remote comparison and reproduced baseline established; named SBOM/SilentProbe evidence not located |
| 1 environment discovery substrate | PARTIAL | Approved JSON catalog → OpenAPI → existing graph works; other advertisements/protocol families not implemented |
| 2 capability representation | PARTIAL | Existing typed graph plus source observations; authentication/authority remain unknown where not demonstrated |
| 3 missing dataflow connections | PARTIAL | Prior generic GraphQL late identifiers and retained projections now work; arbitrary resource-URL extraction, semantic joins and reshaping remain bounded |
| 4 stateful execution | FAIL | Generic asynchronous completion/recovery is missing; pending transport success must not be promoted into business success |
| 5 closed-loop adaptation | PARTIAL | Catalog/contract change, restart, removal and denial controls pass; background observation, comprehensive failure taxonomy and async recovery remain |
| 6 frozen generality and negatives | PARTIAL | Controlled frozen tests and exposed real-provider readbacks; no sealed multi-family independent evaluation |
| Competitive measurements / superior economics | FAIL | No new matched baseline win. Prior saved scripts were faster. Added source acquisition has real latency/cost. |
| Simple supported installation | PARTIAL | Existing CLI/edge accept one optional JSON configuration; full Living Challenge command and unfamiliar-developer trials remain |

The known native memory escape, persistence save race, same-user trust limits, unmediated execution routes, independent-author review, fresh-model/public reuse, full holdout sizes and commercial requirements remain open. **No universal containment, whole-host discovery or commercial superiority is claimed.**

## Reproduction

Use Node 22.18+ and the existing development dependencies; recorded native execution used Node 26.12.0. In this branch:

```sh
npm test
npm run typecheck
npm run proof
npm run build
node --test test/environment-discovery.test.ts
python3 experiments/north-star/check-cli-goal-samples.py docs/adaptive/evidence/cli-migration/before-final docs/adaptive/evidence/environment-discovery/cli-migration 27
python3 experiments/north-star/check-cli-continuity.py docs/adaptive/evidence/cli-migration/before-final docs/adaptive/evidence/environment-discovery/cli-migration 27
python3 experiments/living/verify-engineering-evidence.py docs/adaptive/evidence/environment-discovery-verification.json
```

The commands in `final-commands.json` ran on the exported frozen source identified by `frozen-source.json`. Replays must use new output directories; never overwrite preserved evidence. The known native memory gate can fail even though this recorded run passed. No headline `demo:capability-plane` command is claimed.

Next three engineering priorities:

1. Prevent HTTP pending responses from becoming apparent completed outcomes; implement bounded evidence-driven read-only polling and explicit unresolved consequential outcomes, with interruption/restart and unrelated-interface controls.
2. Close contract-grounded dataflow gaps with a small deterministic transformation vocabulary and provenance, including ambiguous-identifier refusal and unrelated regressions for any recovered SBOM failure.
3. Freeze the integrated discovery/retention/change path, obtain independently selected real-software cases and evaluate acquisition plus maintenance against equally controlled saved scripts and coding agents. Expand discovery families only when those experiments demonstrate a necessary gap.

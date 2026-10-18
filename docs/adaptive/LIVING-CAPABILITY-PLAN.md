# Living Capability Plane: additive execution plan and audit

**Status: PARTIAL. Merge/release recommendation: NO-GO.** This applies the [exact user mission update](LIVING-CAPABILITY-MISSION.txt) to the existing Adaptive Capability Plane goal and Master Execution Specification. It neither restarts the programme nor substitutes dashboard acceptance for the original capability, authority, holdout or commercial requirements.

## Baseline and ownership

Work remains in `/Users/ross/src/rightclick-x-adaptive`, branch `programme/adaptive-capability-plane`. The audit began at `114d501` with planner product `f0bb7d3`; performance evidence was preserved at `4f7f511` before dashboard edits. The first dashboard metric stage is frozen at **`f20eac7`**. The worktree inventory is [retained](evidence/living-stage2/worktrees.txt); the main checkout and older North Star checkout have unrelated generated changes and were not edited. The collaboration inventory contained only this agent. No new branch, worktree or delegated agent was created.

Before dashboard edits, typecheck passed and the complete native suite ran: **290/291, one failure, zero skips**. The unchanged memory-limit test printed `done`. Isolated runs pass on both old and candidate products, which does not diagnose or close the failure. See [the complete performance checkpoint](PUBLICATION-PERFORMANCE.md). The failed runs, setup errors and original thresholds remain preserved. Dashboard work does not modify sandbox enforcement.

## Current implementation audit

| Area inspected | Verified implementation | Gap for the living demonstration |
|---|---|---|
| `src/interface/dashboard.ts` | Embedded, dependency-free HTML, canvas force graph, learn/compose/research controls, fetch-based SSE | Original primary statistics advertised “composite powers”; no inspectable capability nodes or five views; continuous quadratic force layout; missing reduced-motion handling; provider clustering/search absent |
| `src/core/graph.ts` | Real descriptors, typed adjacency, cached potential-walk counts, 1,000-event buffer, drift/retirement events | Edges establish type compatibility rather than complete semantic joins or workflows. Events are in-memory, cursor resets at restart; no durable lifecycle projection |
| `src/runtime.ts` | Generic CLI/OpenAPI/GraphQL/MCP/web discovery; composition, execution, local policy, persistence, healing, saved goals, receipt chain, known changed-meaning refusal | Run records are in-memory; saved trust/receipts do not retain every provider response and witness result. No complete UI-ready six-dimension model or linked composition lifecycle |
| CLI investigation and `semantics.ts` | Version-25 empirical probes, documented argument grammar, exact raw outputs, content/file safeguards, bounded native execution | Exposed dynamic selector and private program-path gaps remain; investigation is not independent outcome verification. Intermittent memory enforcement failure remains open |
| `satisfaction.ts` / `contract.ts` | Required information, identifier evidence, join status, input lineage, intended transformations, explicit predicates/witnesses | Generic type matches remain hypotheses; no predeclared public multi-provider Living Challenge proven yet |
| `verify.ts` and runtime witnesses | Predicate checks distinct from separate read-only provider witnesses; pinned witness contract, repeated checks on reuse | A distinct provider is not necessarily an independent organisation or trustworthy business-state oracle. Runtime `verified` is not an external attestation |
| `knowledge.ts`, saved goals | Portable contracts, revalidation, exact compatibility profile, retained goal interface; prior fresh-process/model reuse evidence | Full cross-vendor challenge and newer unfamiliar inputs remain required; imported/stored labels must not become current UI assurance without evidence |
| `execution-policy.ts`, `authority.ts` | Operator constraints, bounded composite dependency analysis, transport risk lower bounds, fresh checks before dispatch | Local `allowed` is only policy permission: not credential availability, native execution availability, exact-action proof or whole-host control |
| Existing Actenon experiments | Audited source pins; native grants/proofs/replay/effect reservation, mediated and resource-owned boundaries; fresh replay 23/23 with separate proof checker | Still optional source-pinned experiments, not a released core boundary/credential service. Ordinary dashboard has no live Actenon decision source; must display unknown |
| `http.ts`, `tools.ts`, federation | Authenticated `/api/viz`, graph export, SSE, existing HTTP tool dispatch, thirteen MCP tools; generated APIs and peer execution traverse runtime checks | Dashboard reconnect currently drops missed events; stream has no persisted epoch. Five views and evidence references are absent. Keep public shell free of private data; existing API authentication must remain |

Other UI risks identified for the next stage: research results interpolate URLs into HTML attributes using an escaping function that only covers text delimiters; treat this as an unverified injection risk requiring a negative control and safe DOM construction. Network/stream failures can leave old numbers visible without a stale-data notice. Neither issue is promoted to a proven exploit or silently dismissed. The redesigned interface must render untrusted provider content as text, show snapshot age/connectivity, and fail visibly on unavailable evidence.

## Stage 2 implemented: truthful metrics

`dashboard-state.ts` supplies read-only facts to `/api/viz`, with a value, status, source and limitation for each statistic. Existing `powers` response fields and all thirteen MCP tools remain compatible. Topology calculations still use the existing graph cache.

| Display | Definition | What it does not establish |
|---|---|---|
| Providers | `graph.providers.size`, including built-in/generated providers | Connectivity or authority |
| Discovered operations | `graph.capabilities.size`, including generated descriptors | Executability, correct semantics or permission |
| Potential typed paths | `chains2 + chains3`; excludes individual descriptor count | A valid complete workflow, observed effects or verified outcome |
| Independently verified capabilities | `null`, **NOT ASSESSED** | No aggregate independent business-outcome assessment exists; predicates/trust strings/hashes cannot supply it |
| Authorised capabilities | `null`, **UNKNOWN** | Exact principal/action/parameters/boundary decisions are not established by a graph snapshot |
| Retained reusable contracts | Published goals with a matching callable goal descriptor | Current validity or authority; this explicitly counts saved goals, not every static composite or a deduplicated number of novel abilities |

Numeric values update directly, without interpolated counter animations. Provider learning says “operations reflected”; retained composites are not announced as millions of new abilities. A keyboard-operable source disclosure displays all definitions and limitations. No invocation, grant, witness or receipt is created by reading these metrics.

Focused tests cover source math, null versus zero, no side effects, misleading stored trust, missing/withdrawn goal descriptors, authentication, legacy fields, source disclosure and thirteen tools: **14/14 pass**, zero skips; typecheck passes. A fresh loopback runtime with deny-all execution was observed in the actual browser: 2 providers, 23 operations, 85 potential typed paths, unassessed verification, unknown authority and 0 saved goals. Enter activates source disclosure. [Screenshot](evidence/living-stage2/browser-sources.jpg), [live API snapshot](evidence/living-stage2/live-viz.json) and [observation limits](evidence/living-stage2/browser-observation.json) are retained. This is not the visual redesign, mobile/reduced-motion validation or large-graph UI benchmark.

After freezing `f20eac7`, the complete native suite passes **295/295**, zero skips, and the actual `npm run proof` script passes **28/28**. No sandbox code or memory test changed between the preceding failure and this pass. Therefore the intermittent memory issue remains unresolved and release remains NO-GO; a passing rerun does not erase the failed gate. [Stage evidence manifest](evidence/living-stage2-verification.json).

## Shortest path to a complete demonstrated slice

1. **Audit and metrics (current):** retain this source checkpoint and test results. Diagnose the intermittent memory limit; do not weaken its test or advertise hard resource guarantees without evidence.
2. **Lifecycle projection:** add read-only discovery, executability, authority, assurance, reusability and validity dimensions with evidence references. Distinguish declared, last observed and currently unknown facts. Record composition requested/planned/executed/checked/retained/failure transitions from real runtime operations. Bound history; persist the minimum evidence and withdrawal tombstones required for restart honesty. Do not introduce a permission framework or copied crypto.
3. **Dashboard vertical slice:** implement the five views inside the existing HTML runtime with provider clusters, search, keyboard controls, responsive layout and reduced motion. Use safe DOM text construction. Show snapshot/event coverage and missing evidence. Render only bounded visible nodes/links; benchmark representative graphs. A successfully checked *multi-provider* retained capability gets the visible establishment moment; a wrapper or failed run does not.
4. **Authority evidence:** reuse the audited optional Actenon boundary and existing native verifier. Surface actual exact-action decisions and bounded coverage through an explicit optional evidence interface; no adapter means authority not established. Test broker/edge unavailability and never fall back to an unprotected configured consequential operation.
5. **Freeze the Living Capability Challenge before final evaluation:** select real read-only public providers through generic supported discovery; do not write provider adapters. Require two distinct producing providers, a separately controlled outcome oracle, unseen inputs and a misleading semantic match. First validate the lifecycle locally with disposable providers; label those runs as development, not the public challenge. Use disposable protected resources for effect/refusal/readback/change tests. The evaluator's requirements and records remain separate from learner writes.
6. **Fresh-agent and change acts:** retain the capability, start a genuinely fresh agent on new inputs, record tool/time/cost and discovery telemetry. Use a second vendor only if available without spending; otherwise label same-vendor reuse. Existing Claude weekly quota remains blocked until October 22, 11pm London; no early retry/paid fallback. Demonstrate compatible repair and incompatible/removed refusal with live dashboard evidence.
7. **Verification, economics and release:** run all original and additive checks. Compare A/B/C/D under equivalent controls with initial and maintenance costs. Produce an honest PASS/PARTIAL/FAIL/BLOCKED report, then implement and test the actual one-command demo. Prepare a proposed README, not a public replacement, and a 60–90 second evidence-based video brief. Investigate the available `brag` skill only when recorded proof is ready to package; no animation may impersonate execution.

No `demo:capability-plane` command is advertised as implemented. The existing `serve --demo` is a toy-service demonstration and does not meet the new public-provider/independent-evaluator challenge.

## Additive G1–G16 acceptance matrix

These gates do not supersede [the original acceptance matrix](ACCEPTANCE-MATRIX.md), holdout sizes, strict error thresholds or economic criteria.

| Gate | Status | Evidence / remaining work |
|---|---|---|
| G1 truthful statistics | PASS | Current header and learning/retention messages use explicit definitions; unknown values remain null. Scope is the corrected metric surface |
| G2 sourced authority and verification states | PARTIAL | Metrics do not fabricate authority/verification; per-capability states and inspectable evidence views remain |
| G3 unfamiliar provider contributes real operations | PARTIAL | Existing generic discovery; no new final Living Challenge provider/input set evaluated |
| G4 useful multi-provider execution | PARTIAL | Existing runtime/proof fixtures; the public-provider headline workflow remains |
| G5 independent required outcome check | PARTIAL | Existing witness/native checkers; separately controlled final evaluator and complete headline oracle remain |
| G6 fresh-agent reuse | PARTIAL | Prior actual same-vendor development sessions; new multi-provider capability/new input reuse remains |
| G7 protected unauthorised refusal | PARTIAL | Audited bounded Actenon demonstrations; integrate actual decisions/effect readback into the live challenge |
| G8 safe compatible adaptation | PARTIAL | Existing bounded lifecycle passes; live headline workflow and dashboard transition remain |
| G9 incompatible/removed refusal | PARTIAL | Known changed-action safeguards and removal tests; live status/tombstone display remains |
| G10 truthful lifecycle visualisation | PARTIAL | Existing event stream and corrected counts; full linked lifecycle view absent |
| G11 complete regression suite | FAIL | Latest frozen run 295/295, but the preceding 290/291 memory-limit failure is not diagnosed/remediated; retain failed acceptance until the instability is resolved |
| G12 reproducible headline demo | BLOCKED | Complete vertical slice/evaluator/command not yet implemented; do not relabel the toy demo |
| G13 actual benchmark cost/correctness | PARTIAL | Preserved adverse agent results and bounded planner measurements; full new lifecycle comparison remains |
| G14 thirteen-tool compatibility | PASS | Tool list unchanged; authenticated HTTP/interface regressions pass |
| G15 no high-severity regression | PARTIAL | No execution-control changes in this UI stage; unresolved memory failure, UI security controls and independent review remain |
| G16 advantage or explicit absence | PASS | Reporting clause only: **advantage not established**. The original goal still requires a demonstrated advantage |

## Required deliverable tracking

| Deliverable | Status | Current boundary |
|---|---|---|
| 1 Upgraded dashboard | PARTIAL | Metric correction only; five-view redesign remains |
| 2 Accurate capability-state model | PARTIAL | Sourced metric model, six dimensions still to implement |
| 3 Lifecycle events | PARTIAL | Existing real graph/run events; composition/evidence linkage and persistence remain |
| 4 Searchable/inspectable graph | PARTIAL | Runtime search/explain exists; dashboard controls absent |
| 5 Authority/consequence views | PARTIAL | Local audit and bounded Actenon evidence exist; live view absent |
| 6 Evidence explorer | PARTIAL | Runtime run records and receipts exist; complete explorer absent |
| 7 Multi-provider demonstration | PARTIAL | Exposed fixtures only for the new mission |
| 8 Actenon protected demonstration | PARTIAL | Bounded source-pinned demonstrations pass; live optional UI integration remains |
| 9 Fresh-agent evidence | PARTIAL | Prior actual same-vendor evidence; new challenge remains |
| 10 Adaptation/withdrawal evidence | PARTIAL | Prior bounded evidence; live challenge remains |
| 11 Regression/adversarial tests | PARTIAL | New metric tests pass; unresolved full-suite security failure |
| 12 Independent verification | BLOCKED | Same-author separate checkers exist; independent final evaluator/author review unmet |
| 13 Performance benchmarks | PARTIAL | Existing measured results; large-graph UI and new lifecycle comparison remain |
| 14 One-command demo | BLOCKED | Not implemented; do not advertise a command |
| 15 Proposed README | PARTIAL | Existing documentation; new supported-claim proposal pending demonstrated slice |
| 16 Launch video brief | BLOCKED | Wait for actual recorded seven-act evidence |
| 17 Commercial assessment | PARTIAL | No qualifying advantage; human validation gates unchanged |
| 18 Security/coverage limitations | PASS | Explicit current boundaries here and in release/Actenon reports; continue updating with evidence |
| 19 Merge/release recommendation | PASS | Explicit **NO-GO**, with no merge/push/publication/spending |
| 20 Complete acceptance matrix | PASS | All additive gates/deliverables tracked without promoting missing work |

Completion requires the original programme and the complete mission update, not just a green dashboard gate. Failed, unknown and resource-blocked results remain visible. No public README replacement, launch, outreach or paid infrastructure is authorised.

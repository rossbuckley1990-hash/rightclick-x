# Living Capability Plane: additive execution plan and audit

**Status: PARTIAL. Merge/release recommendation: NO-GO.** This applies the [exact user mission update](LIVING-CAPABILITY-MISSION.txt) to the existing Adaptive Capability Plane goal and Master Execution Specification. It neither restarts the programme nor substitutes dashboard acceptance for the original capability, authority, holdout or commercial requirements.

Latest engineering increment: [ordinary composition recovery](COMPOSE-RESUME.md), frozen `1eaf85f6`, closes the prior planned/saved-goal recovery gap for eligible flat plans. It preserves complete goal definitions and outcome obligations, adds a CLI host opt-in and proves process-kill recovery through the existing compact interface. Native Actenon experiments now consume ordinary composition rather than a manually installed composite. Validation is 418 native, 113 Linux, 28 proof, 30 protected-composition and 29 protected-async checks. Remaining recovery scope includes nested/fan-out/pending-witness work and version/downgrade refusal. Prior references to planned recovery being open describe their earlier freezes. G6, G12, G16, independent authorship, containment and commercial gates remain incomplete.

The subsequent Universal, Environment-Native Capability Discovery mission is reconciled in [the environment checkpoint](ENVIRONMENT-DISCOVERY.md) and [HTTP continuation checkpoint](HTTP-PENDING.md). Existing `context_research` refreshes operator-approved catalogs and feeds the same graph, planner, execution policies and lifecycle evidence. The supported 202/303 profile now completes a discovered multi-provider workflow and reuses it in a new process; pending state cannot become a checked result through composition, federation or generated APIs. The reproduced FileStore race is fixed. The subsequent [protected async checkpoint](PROTECTED-ASYNC.md) establishes exact-action follow-ups in a resource-owned local fixture and terminal refusals across runtime paths. The [explicit HTTP recovery checkpoint](HTTP-RESUME.md) now persists bounded HTTP leaf continuations and survives a real process kill without resubmitting the action; fresh Actenon authority is required on resumed reads. The [retained workflow checkpoint](WORKFLOW-RESUME.md) adds opt-in recovery for flat sequential composites with bounded inputs/outputs and no effect replay. The [protected remaining-workflow experiment](PROTECTED-WORKFLOW.md) now demonstrates exact native authority for a resumed publication and refusal after revocation between steps. Additional discovery families, planned/saved-goal recovery, fan-out and pending witnesses, general deployment coverage and independent holdouts remain open. [Real public composition and fresh-process reuse](LIVING-PUBLIC.md) pass historical separate DOI/title/publisher readbacks, preserving the earlier wrong dataset result. This advances G3–G5 within exposed development scope; it does not close G6's actual fresh-agent requirement, G12's complete headline demonstration or G16's economic gate.

Dashboard implementation: [runtime-backed lifecycle and five views](LIVING-LIFECYCLE.md), product `7d5de67`. Six separate dimensions, bounded persisted observations, paginated search and fixture-backed browser checks are implemented. Independent authority decisions, the public-provider challenge, complete traces, large-graph browser evaluation and economic advantage remain open.

Latest security checkpoint: [sandbox resource diagnosis](SANDBOX-RESOURCES.md) corrects observer loss and overlapping polls. Frozen product `997580d` passes 308 native tests, 34 focused Linux checks and 28 proof checks. A short allocation still exceeds its sampled budget and completes; hard native memory containment remains failed. This partial remediation does not close G11/G15 or replace the public-provider challenge.

## Baseline and ownership

Work remains in `/Users/ross/src/rightclick-x-adaptive`, branch `programme/adaptive-capability-plane`. The audit began at `114d501` with planner product `f0bb7d3`; performance evidence was preserved at `4f7f511` before dashboard edits. The first dashboard metric stage is frozen at **`f20eac7`**. The worktree inventory is [retained](evidence/living-stage2/worktrees.txt); the main checkout and older North Star checkout have unrelated generated changes and were not edited. The collaboration inventory contained only this agent. No new branch, worktree or delegated agent was created.

Before dashboard edits, typecheck passed and the complete native suite ran: **290/291, one failure, zero skips**. The unchanged memory-limit test printed `done`. Isolated runs pass on both old and candidate products, which does not diagnose or close the failure. See [the complete performance checkpoint](PUBLICATION-PERFORMANCE.md). The failed runs, setup errors and original thresholds remain preserved. Dashboard work does not modify sandbox enforcement.

## Initial implementation audit (before lifecycle changes)

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
| G2 sourced authority and verification states | PARTIAL | Six sourced dimensions and linked historical summaries now exist; live independent boundary evidence and complete outcome traces remain |
| G3 unfamiliar provider contributes real operations | PARTIAL | Existing generic discovery; no new final Living Challenge provider/input set evaluated |
| G4 useful multi-provider execution | PARTIAL | Existing runtime/proof fixtures; the public-provider headline workflow remains |
| G5 independent required outcome check | PARTIAL | Existing witness/native checkers; separately controlled final evaluator and complete headline oracle remain |
| G6 fresh-agent reuse | PARTIAL | Prior actual same-vendor development sessions; new multi-provider capability/new input reuse remains |
| G7 protected unauthorised refusal | PARTIAL | Audited bounded Actenon demonstrations; integrate actual decisions/effect readback into the live challenge |
| G8 safe compatible adaptation | PARTIAL | Existing bounded lifecycle passes; live headline workflow and dashboard transition remain |
| G9 incompatible/removed refusal | PARTIAL | Known changed-action safeguards and removal tests; live status/tombstone display remains |
| G10 truthful lifecycle visualisation | PARTIAL | Bounded persisted composition/execution/withdrawal observations and five views demonstrated; detailed attempt traces and full challenge remain |
| G11 complete regression suite | FAIL | Latest observer correction: 308/308 native and 34/34 focused Linux; earlier C2 failure preserved. Short-allocation escape reproduced after the fix; hard resource gate remains failed despite passing regression runs |
| G12 reproducible headline demo | BLOCKED | Complete vertical slice/evaluator/command not yet implemented; do not relabel the toy demo |
| G13 actual benchmark cost/correctness | PARTIAL | Preserved adverse agent results and bounded planner measurements; full new lifecycle comparison remains |
| G14 thirteen-tool compatibility | PASS | Tool list unchanged; authenticated HTTP/interface regressions pass |
| G15 no high-severity regression | PARTIAL | Hostile labels rendered inert in browser; history changes preserve controls. Observer loss corrected; native memory escape, comprehensive UI/security evaluation and independent review remain |
| G16 advantage or explicit absence | PASS | Reporting clause only: **advantage not established**. The original goal still requires a demonstrated advantage |

## Required deliverable tracking

| Deliverable | Status | Current boundary |
|---|---|---|
| 1 Upgraded dashboard | PARTIAL | First five-view dashboard implemented; headline live challenge and UX validation remain |
| 2 Accurate capability-state model | PARTIAL | Six sourced dimensions implemented; exact-action authority remains explicitly unknown |
| 3 Lifecycle events | PARTIAL | Bounded actual composition/execution observations, receipt links, persisted withdrawal IDs; complete attempt traces remain |
| 4 Searchable/inspectable graph | PARTIAL | Provider clusters, paginated search and inspection work; representative browser-scale evaluation remains |
| 5 Authority/consequence views | PARTIAL | Local policy view exists with unknown independent authority; optional live decision source remains |
| 6 Evidence explorer | PARTIAL | Historical summary explorer and linked run/receipt references implemented; full outcome/authority evidence remains |
| 7 Multi-provider demonstration | PARTIAL | Exposed fixtures only for the new mission |
| 8 Actenon protected demonstration | PARTIAL | Bounded source-pinned demonstrations pass; live optional UI integration remains |
| 9 Fresh-agent evidence | PARTIAL | Prior actual same-vendor evidence; new challenge remains |
| 10 Adaptation/withdrawal evidence | PARTIAL | Prior bounded evidence; live challenge remains |
| 11 Regression/adversarial tests | PARTIAL | Lifecycle/negative-control checks and frozen regressions pass; earlier intermittent security failure remains unresolved |
| 12 Independent verification | BLOCKED | Same-author separate checkers exist; independent final evaluator/author review unmet |
| 13 Performance benchmarks | PARTIAL | Synthetic API scale measured through 10,020 descriptors; browser scale and comparative lifecycle economics remain |
| 14 One-command demo | BLOCKED | Not implemented; do not advertise a command |
| 15 Proposed README | PARTIAL | Existing documentation; new supported-claim proposal pending demonstrated slice |
| 16 Launch video brief | BLOCKED | Wait for actual recorded seven-act evidence |
| 17 Commercial assessment | PARTIAL | No qualifying advantage; human validation gates unchanged |
| 18 Security/coverage limitations | PASS | Explicit current boundaries here and in release/Actenon reports; continue updating with evidence |
| 19 Merge/release recommendation | PASS | Explicit **NO-GO**, with no merge/push/publication/spending |
| 20 Complete acceptance matrix | PASS | All additive gates/deliverables tracked without promoting missing work |

Completion requires the original programme and the complete mission update, not just a green dashboard gate. Failed, unknown and resource-blocked results remain visible. No public README replacement, launch, outreach or paid infrastructure is authorised.

# Adaptive Capability Plane: baseline and critical path

Date: 2026-10-18. Status: **PARTIAL programme; baseline checks PASS; release NO-GO**.

The mission is the user's Adaptive Capability Plane request, including all eight original outcomes and the expanded 18-section mission. This record is evidence and a work plan, not a replacement for the goal or a reduction of its scope.

## Source selection

Repository remote: `https://github.com/rossbuckley1990-hash/rightclick-x.git` (read from local configuration; no fetch/push performed).

Starting commit: **`03d5bf76c428d3c9ce88caad2737a63ebc2f71cb`**.
Isolated programme branch: **`programme/adaptive-capability-plane`**.
Checkout: `/Users/ross/src/rightclick-x-adaptive`.

| Local branch | Head at audit | Relationship |
|---|---|---|
| main | c27289e | Older baseline |
| fix/security-boundaries | 9e76f00 | Ancestor of selected baseline |
| feature/universal-capability-engine | 0c3b3aa | Ancestor of selected baseline |
| Ross/gallant-mendel-7f183f | 1e191f8 | Goal-satisfaction/fan-out work, already contained |
| programme/rightclick-x-north-star | 03d5bf7 | Strongest local implementation: security, semantics, CLI investigation, knowledge and compatibility work |

All local refs and worktrees were enumerated. No newer implementation branch was found. No applicable AGENTS.md was found in the checkout or its ancestors. ZIP snapshots were inspected and their source compared against their corresponding checkouts: every compared source file matched. See [snapshot audit](evidence/snapshot-audit.json). Public GitHub state has not been independently refreshed; local refs are authoritative for this baseline selection.

The North Star worktree contains uncommitted benchmark and generated proof/lab results. These were not reset, modified or committed there. Its 256-session benchmark was copied as a separately named raw evidence artifact, with its hash recorded by the correction script. The committed version has only 47 sessions. Treating the committed file as the complete experiment would miss material evidence.

## Baseline reproduced

Node v24.16.0; npm 11.17.0; macOS host sandbox. Dependencies installed offline, ignoring install scripts. A separate detached worktree at the exact starting commit was used for build/proofs/demo.

| Check | Result | Evidence |
|---|---|---|
| Typecheck and regression, nested Codex sandbox | 154 passed, 45 skipped; insufficient for acceptance | [log](evidence/baseline-restricted-check.log) |
| Typecheck and regression, host sandbox available | **199 passed, 0 failed, 0 skipped** | [log](evidence/baseline-host-check.log) |
| Node/edge build | PASS; edge compilation is not a deployed-platform test | [log](evidence/baseline-build.log) |
| Evaluation harness typecheck | PASS | [log](evidence/baseline-harness-check.log) |
| Lifecycle proof | **28/28** | [raw proof](evidence/baseline-proof.json) |
| Negative controls | **6/6** | [raw controls](evidence/baseline-negative-controls.json) |
| Lab direct / gateway | **30/30 each** | [all 60 raw results](evidence/baseline-lab-results.json) |
| Scripted unknown-program demo | first, reuse, compatible, incompatible, removal, restore PASS | [log](evidence/baseline-demo.log) |

These are development/regression proofs, not new sealed holdouts or live model-swap evidence. The lab's historical `lab-freeze*` tag field does not match this baseline; the run source is the exact detached commit above with unchanged product files. No lab result is re-labelled as an independently selected holdout.

## Historical failures: current interpretation

| Finding | Evidence and current status |
|---|---|
| mandoc → od changed the requested input | Preserved in UCE evidence. Current semantic regression catches this class. Word-based lineage and preservation remain incomplete semantic models; passing S1 is not a general proof. |
| Weak unfamiliar-program generalisation | UCE: 3/12 programs across successive freezes; those targets are development data now. North Star freeze-1 selected 8 eligible programs, below its fixed 10-program/40-task minimum. New independent evidence remains required. |
| Poor competitive performance | UCE measured higher RightClick X tokens and time. North Star retained the same pattern and substantial correctness failures; see corrected accounting below. No competitive advantage established. |
| Identifier and operation identity errors | Identity evidence, satisfaction checks and OLS operation-reassignment regressions exist. Generic joins still cannot prove identity. |
| Expensive reuse | Saved goals re-plan on every invocation. Crystallised pipelines and unchanged-program caching exist, but a validated direct saved-goal hot path remains to be measured. |
| Narrow knowledge portability | Stored examples reproduce exact behaviour; cross-platform formatting differences often cause refusal. Semantically equivalent cross-implementation reuse remains unproven. |
| Existing security work | Credential redirects, filesystem confinement, local-program authority, sandboxing, retry limits, MCP unknown-effect defaults, publication and evidence authorities are covered by current passing regressions. Same-user executable races, polling limits and unmediated paths remain limitations. |
| New execution policy gap | No general operator allow/deny policy existed. Five proposed-policy tests fail on baseline; a sixth independently reproduces existing network-scope widening. [Preserved baseline failures](evidence/execution-policy-before.log). |
| Commercial demand | No independently validated buyer, paid pilot, retention or willingness to pay. Technical success must not be described as commercial validation. |

## Benchmark accounting correction

The larger uncommitted `ns-freeze-1` file has **89 explicit weekly-limit responses** that the harness failed to recognise. The old matcher recognised session/usage limits but omitted weekly limits. **88** contain zero tokens and zero tool calls; one was interrupted after some model usage with no target execution. None establishes a task outcome.

The original file and scores are preserved. `experiments/north-star/correct-quota.ts` creates a new file exclusively (`wx`), records the raw SHA-256 and reclassification reason, and adds only the blocked marker. It does not change any original correctness/oracle judgment.

| Arm | Recorded sessions | Blocked | Feasible observed | Correct |
|---|---:|---:|---:|---:|
| A: direct tools | 64 | 17 | 24 | 13 |
| B: documentation | 64 | 24 | 20 | 12 |
| C: saved skills | 64 | 24 | 20 | 12 |
| D: RightClick X | 64 | 24 | 20 | 3 |

These are incomplete, unequal samples, not a valid superiority comparison. Missing sessions remain missing evidence. D also has four recorded wrong-presented-as-correct outcomes across the observed lifecycle. All failures remain failures. [Raw](evidence/imported-benchmark-ns-freeze-1-raw.json), [corrected](evidence/imported-benchmark-ns-freeze-1-corrected.json), [correction audit](evidence/quota-correction.log).

Failure diagnosis confirms several mechanisms already changed after that freeze: JSON file materialisation, parameterised options, two-file channels, content extensions, manual lookup and declared-only interfaces. Re-running these exposed tasks would be regression testing, not a fresh holdout. Further arbitrary feature expansion would avoid the real question; next performance work must measure a complete verified reuse lifecycle against saved scripts/skills.

Additional reporter defects remain to fix before a new benchmark: stage 4 reads a nonexistent `D.reuseRate`; stage 3's pass expression omits domain-2/security requirements; pairing and gate decisions must reject incomplete coverage. Historical reports will not be silently overwritten.

## Critical path and unchanged acceptance

1. Close the demonstrated authority gap and test all mediated entry points, including repair and generated APIs. First decisive experiment is explicitly read-only; writes only to disposable fixtures.
2. Extend existing capability cards/contracts with evidence and bounded consequence analysis. Describe unknown credentials, hidden provider effects and unmediated tools explicitly. Do not add a second orchestrator or a fourteenth MCP tool.
3. Establish a deterministic saved-capability hot path that retains semantic contracts, independent witnesses, authority and invalidation. Benchmark full acquisition/reuse/verification costs before broadening features.
4. Freeze source. Select fresh eligible software independently. Run A/B/C/D with matched models, information, access and budgets, and independent oracles. Preserve original North Star gates; expanded mission targets are 20 unfamiliar targets, 100 tasks, multiple categories, two platforms where available, ≥90% correct within eligible scope, zero falsely verified/unauthorised outcomes, and a material cost or maintenance advantage. An insufficient sample is PARTIAL.
5. Run the Capability Plane Challenge A–H, real model swap, clean-install proof, and an independent assessment. Only then prepare evidence-backed product claims, video brief, economic model, pilot plan, scorecard and release recommendation.

Current resource check: both installed CLIs authenticate through existing ChatGPT/Claude subscriptions when host credential access is available. A sandboxed Claude auth check falsely appeared logged out; the host check corrected it. No new model execution or paid API call was made in this stage. Historical October 22 quota blocks are not assumed to describe current account state. Model availability must be measured before scheduling evaluations.

No external deployment, push, merge, publication, purchase or message to prospective customers has occurred. Release remains **NO-GO** pending the complete technical and independent-validation gates.

# Recovery through ordinary composition

**Partial engineering milestone; release NO-GO.** Work continues on `programme/adaptive-capability-plane` from `d4c2ac74de96000424cb8570ccf7d1add68f0ef8`. Product freeze: `1eaf85f6a13f2d6dd61c885eb33ad0ee474634b8`. The first implementation commit, `d4bc29338cc753521cbf9be2d1c8bd0a4143d410`, is retained, including the subsequently identified output-view defect. No original acceptance threshold is changed.

## Invariant and implementation

When an eligible composition pauses, its selector names the entire selected execution. Resuming cannot replace its inputs, checks, chosen steps or caller egress restrictions. Previously completed effects are not repeated. Current host policy, current saved-goal definitions and current native authority still apply.

Previously, `context_compose` exposed the pending HTTP leaf without retaining the surrounding composition. A fresh process could read that leaf's result but could not finish its remaining operations and checks. The new failing regression records that behavior before implementation.

The existing workflow checkpoint now optionally contains the planner's selected flat plan and its completion obligations. This private execution is not inserted into the public graph and cannot be chosen by another plan. Initial composition and recovery use the same step runner and the same completion function. They retain predicates, required information, pinned witnesses, observed input-word preservation, egress limits and requested local goal publication. A successful run can crystallize its pipeline and expose its saved goal only after checking the outcome under the current publication policy.

Saved-goal invocations, including the shared generated-API entry path, pin the full goal definition. Calls and historical pipeline counters are excluded from that definition. A changed definition or denied goal prevents recovery before another provider request. Additional `context_run` predicates also travel with a pending goal. A hash-bound local receipt links the original goal run to its complete retained execution; a leaf-only continuation cannot settle the goal. These hashes are local integrity bookkeeping, not independent authority.

Crystallized pipelines now retain caller origin restrictions and observed preservation obligations for subsequent inputs. Private execution IDs do not accumulate in the capability graph or reliability ledger. The resume record exposes only completion metadata; its result uses the existing output view. No new public tool, provider-specific runtime branch, dependency, issuer or cryptographic implementation was added.

## Installation and use

Hosts explicitly opt in because recovery stores bounded business inputs and outputs in their local state file:

```sh
RCX_WORKFLOW_RECOVERY=1 node bin/rcx.ts mcp
```

The SDK equivalent is `workflowRecovery: true` with a `Store`. It is off by default. The existing `context_runtime` reports the setting. CLI values other than `0` or `1` fail before state access.

Use the ordinary `context_compose` request. If its result is pending and includes `pending.resumeId`, pass that exact selector to `context_run`, omitting replacement arguments, confirmation and checks. After a restart, `context_run_status` lists retained executions. The CLI equivalent is:

```sh
RCX_WORKFLOW_RECOVERY=1 node bin/rcx.ts run 'resume:<returned-run-id>'
```

This is deterministic recovery of a selected plan, not rediscovery or inference. A checkpointed failure does not trigger an alternative plan. Existing non-retained planning behavior remains available for unsupported shapes.

## Tests and measured evidence

| Check | Final result |
|---|---|
| Full native regression suite | 418/418; zero skipped; 31.090 seconds |
| Focused Linux suite, cached Node 24.22 image | 113/113; zero skipped; 13.624 seconds |
| Focused workflow suite | 19/19 |
| Existing lifecycle proof | 28/28 |
| Typecheck and both bundles | Pass |
| Protected ordinary-composition experiment | 30/30 |
| Existing protected async regression | 29/29 |

Native and Linux include a real SIGKILL/FileStore case. A catalog advertises an ordinary compression contract. The runtime learns it, its planner wires enqueue to digest publication, and the client is killed during the first monitor read. A fresh process consumes the whole-plan selector, reads the completed result and publishes the actual gzip digest once. Separately held gzip bytes decompress to the original document. There is one enqueue and no discovery request during recovery. The previous direct-leaf and direct-workflow process-kill tests also remain.

Negative controls cover changed remaining contracts, expired/disabled recovery, replacement inputs, uncheckpointed dispatch, persistence failure, oversized/credential-like/lossy data, changed saved-goal definitions, denied goals, failed caller predicates, narrowed publication policy, egress refusal, changed/refuting/denied witnesses, simultaneous recovery, successive pending steps and snapshot-order restoration. Input-word preservation is checked both after composition recovery and on a crystallized capability's different input. Twelve repeated compositions add no private graph capabilities or per-execution reliability entries.

The Actenon development client now calls `context_compose`; it no longer materializes a manual composite through the SDK. Fresh isolated containers resume the selected plan with native exact-action proofs. One workflow completes its remaining publication; two other publications are refused, including revocation between result read and the following POST. A separate, explicitly authorized native proof control publishes another artifact and is excluded from workflow successes.

The separate native checker verifies three gzip artifacts, two publication files, 14 exact successful request proofs and 50 signed resource artifacts. It rejects five corrupted evidence copies. The existing async checker separately reconciles its seven artifacts and native proofs/attestations. Both checkers are separate implementations by the same author. They are not independent-author review.

Final measurements are recorded verbatim in `evidence/compose-resume/protected-final2/measurements.jsonl`. They include container launch, IPC and polling. They are single controlled observations, not a matched speed benchmark. The source advertisement and paused plan have 25 capabilities/two providers, including built-ins; successful completion adds a crystallized capability and a saved goal, reaching 27/four. No private pending capability is advertised.

| Final controlled process | Wall time | Reported RSS |
|---|---:|---:|
| Catalog discovery | 302.402 ms | 65,454,080 bytes |
| Compose through first pause | 359.828 ms | 79,540,224 bytes |
| Authorized recovery and retention | 258.630 ms | 65,974,272 bytes |
| Revoked between result and publication | 1,027.938 ms | 66,002,944 bytes |

The full suite was run on the exact bytes recorded in `tested-sources-final.json` immediately before the final product commit. The native-boundary experiments then ran at that commit. The [manifest](evidence/compose-resume-verification.json) checks both bindings, all retained artifacts, proof source hashes and native checker results.

The final reconciliation passes across 138 source files and 528 evidence artifacts. It does not reclassify historical failed trials as passing runs.

## Preserved failures and limits

`evidence/compose-resume/` preserves the original leaf-only failure, intermediate TypeScript failures, sandbox-denied listener runs, the native experiment's stale 28-versus-30 assertion and the output-view regression. The latter caught a duplicate complete result nested inside resume metadata; the correction removes that second output route. The passing implementation and the failed checkpoint remain separate local commits. No failed evidence was overwritten.

The supported profile remains bounded, flat sequential execution: at most 16 leaf steps, 64 retained workflows, 64 KiB each and one hour. Nested compositions, fan-out, destructive workflows, pending outcome witnesses and arbitrary custom network handles are not generalized. Unsupported compositions may still expose leaf-only pending state; this increment does not label that state as whole-goal completion. Expired or uncertain executions are not automatically evicted or retried.

Local state is not encrypted and recognizable-secret rejection is not comprehensive data classification. Same-revision restart is tested; downgrade enforcement, older writers and cross-version migration are not established. In particular, older runtimes may ignore newly retained composite restrictions. Use the frozen revision for reproduction; broad version-compatible state reuse is not accepted.

No multi-writer/distributed lock, power-loss guarantee, exactly-once guarantee or general ambiguous-effect reconciliation is claimed. Process-kill and resource-owned authority are demonstrated in separate scenarios, not one combined crash/authority test. The controlled resource's single protected listener is covered by direct API, aliases, shell/socket and credential-absence probes; other host tools and resources remain outside that boundary.

The test providers, task requests, anchors and checks are supplied by the development harness. Bindings and execution are runtime-generated from reflected contracts. These are exposed development cases, not independently selected unfamiliar holdouts or new live-model sessions. No new external-service result is claimed; historical public DOI/title/publisher evidence remains in [the public workflow report](LIVING-PUBLIC.md).

## Coverage and release assessment

This advances original outcomes 2, 4, 5 and 7 for ordinary composition, extends the bounded Actenon evidence for outcome 3, and adds an explicit installation setting toward outcome 8. It uses the existing environment discovery path for outcome 1. It establishes no economic win for outcome 6 and closes no broad original release gate.

The adverse saved-script comparison, native hard-memory containment failure, independent-author holdouts/review, full seven-act challenge, actual unfamiliar fresh-model inheritance and human/commercial validation remain open. The review connector was unavailable (`unsupported call: tool_searchtool_search_tool`); no independent reviewer ran. Release remains **NO-GO**.

Next three engineering priorities:

1. Freeze an independently selected unfamiliar scenario, including actual fresh-model inheritance and a combined crash/independent-authority test.
2. Measure acquisition, reuse and compatible-change costs against the strongest equally protected saved-script/coding-agent baseline.
3. Resolve state-version/downgrade refusal and installation compatibility before widening the recovery profile; then select nested/fan-out or additional discovery families using observed demand.

## Reproduce

At the product freeze, with installed local dependencies:

```sh
npm run typecheck
npm test
npm run proof
npm run build
```

Use the audited Actenon environment and cached image from [the experiment README](../../experiments/actenon/README.md). Choose a new output directory; the runner refuses an existing directory and never pulls an image.

```sh
/absolute/audit-root/.venv/bin/python experiments/actenon/workflow.py \
  --image sha256:5e95a1b7bdb5ddd279c4c18760a007a98f94c6fb24236433c19b61831bc4e4f5 \
  --output /absolute/new-compose-recovery-evidence
/absolute/audit-root/.venv/bin/python experiments/actenon/check-workflow.py \
  /absolute/new-compose-recovery-evidence
/absolute/audit-root/.venv/bin/python experiments/living/verify-compose-resume.py \
  docs/adaptive/evidence/compose-resume-verification.json
```

The last command checks the retained evidence without executing a service or model. The evidence/reporting commit adds that manifest and checker while leaving the frozen product unchanged.

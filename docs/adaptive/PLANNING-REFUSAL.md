# Explain lost permission without executing a diagnostic plan

**Increment PASS; North Star completion PARTIAL; release NO-GO.** Starting revision: `e197073475527c8eb1a16ac6e6cdff1284a948cb`. Product revision: `26df63b4f80b770286975ba4ebbac3b3c75eaf56`, on the existing `programme/adaptive-capability-plane` branch. Main, releases, other worktrees and previous failed experiments were preserved.

The preceding fresh-model trial refused a retained public workflow after origin permission was removed, but reported only “no pipeline found for saved goal.” This concealed the difference between missing capability and restricted execution. It also recorded the policy refusal as negative execution experience. The new regression work reproduced another defect: `risks: []` was treated as unrestricted by the planner and dispatched a mock POST. An empty origin scope still stopped that mock at transport, but incorrectly produced an executable plan.

## General change

Explicit empty risk/origin lists now mean no permitted risks/origins; omission remains unrestricted at that layer. The host's policy and all other execution checks still apply.

If permitted planning finds no route, a separate, read-only search can explain a structurally established candidate excluded by current local restrictions. It checks the same types, required information, lineage, anchors, unsupported modes, recursion and changed-meaning safeguards. The diagnostic gets a smaller expansion budget of 512 per depth and at most five candidates. Its assessments never seed executable-plan caches. Its plans cannot be returned for execution, installed, published or used for acquisition. The diagnostic does not change policy.

`planningRefusal` names the excluded operations and reasons. It explicitly states `local-runtime-policy`, `bounded-candidate-search` and `independentAuthority: not-assessed`. It travels through ordinary composition, retained goals, nested composites, MCP and generated REST/GraphQL responses. Nested refusal stops repair and replacement planning and does not degrade provider experience. A peer's report is sufficient to stop locally, but its claimed capability IDs, run IDs and authority assertions are discarded.

No protocol-specific provider branches, dependencies, tool names, saved-state format, cryptography or Actenon authority implementation changed. The thirteen `context_*` tools remain. This reuses existing local policy assessment; the audited optional independent boundary remains necessary for protected resources.

## Measurements and preserved failures

All comparison transports are counted offline mocks. The real public acquisition snapshot is unchanged: SHA-256 `30b02ea92b6bced59981750525e48bcb48ed4b59e19b268092cb2a0b96562ea3`. Its restored graph contains 69 capabilities. There were no new model sessions or external API requests.

| Observation | Starting revision | Product revision |
|---|---:|---:|
| Retained-public denied attempts with actionable local diagnosis | 0/10 | 10/10 |
| Provider requests in those attempts | 0 | 0 |
| Attempts preserving execution experience | 0/10 | 10/10 |
| Mock POST dispatches with explicit empty risk list | 1 | 0 |
| Plans returned with explicit empty origin list | 1 | 0 |
| Mock POST dispatches with omitted request restriction | 1 | 1 |
| Median denied-call duration | 0.523 ms | 523.457 ms |

The extra diagnosis is substantially slower than the baseline's uninformative failure. This is a correctness and usability improvement, **not a speed or commercial-economics win**. The initial larger diagnostic search took 3,459.906 ms in its public-state test; the bounded candidate passed that test in 555.606 ms. These single-test observations are distinct from the ten-sample comparison. The fixed budgets do not establish a wall-clock bound for arbitrary graphs.

Preserved evidence includes five failing tests out of the initial six, the first slower candidate, every intermediate regression run, both comparison generations, and a comparison-harness syntax failure. The baseline archive contains only source/package files from the exact starting commit; no branch switch was needed.

## Verification

- Final native suite: **441/441**, zero failed/cancelled/skipped, 28,265.506 ms.
- Final cached offline Linux subset: **136/136**, zero failed/cancelled/skipped, 11,562.639 ms.
- Typecheck, Node/edge builds and **28/28** proof checks pass.
- Nine new tests cover denied composition, generated interfaces, retained reuse/reauthorization, explicit empty scopes, partial origins, nested refusal, changed meaning, incompatible inputs/missing information, and untrusted peer claims. The preserved public GraphQL/OpenAPI graph is a development regression; the unrelated shipment/tracking fixtures are controlled development cases.
- The separate comparison checker passes and rejects six corruptions: dispatch, hidden transport, forged authority, changed execution experience, missing diagnosis and source mismatch.
- Existing native Actenon protected workflow: **30/30** controls. A separate checker verifies one completed workflow, two refused remaining effects, three jobs, two publications including one separate native control, fourteen successful exact proofs and fifty signed artifacts. Five artifact/proof/extra-effect corruptions are rejected.

The checkers are separate implementations by the same author. Independent-author review was unavailable: tool discovery returned `unsupported call: tool_searchtool_search_tool`. No independent review or sealed holdout is claimed.

Final offline reconciliation passes for **142 frozen source/test/harness files and 128 evidence artifacts**, rerunning both comparison and native artifact checkers. The [manifest](evidence/planning-refusal-verification.json) and [result](evidence/planning-refusal-verification-result.json) are retained. Checksums establish consistency with the stated local revision, not certification or authorship independence.

## Original outcome coverage

| Required outcome | Contribution here | Remaining boundary |
|---|---|---|
| Discover unfamiliar software | None added; existing discovery remains | Wider environment/protocol coverage and independent holdouts |
| Establish and verify meaning/outcomes | Refusal no longer becomes behavioral failure evidence | Arbitrary semantics and independently checked final challenge |
| Enforce authorized restrictions | Correct empty scopes; truthful local diagnosis; native boundary regression passes | Same-host alternate routes and hard native memory containment remain outside this claim |
| Reusable inherited capabilities | Retained goal identifies lost permission and works after current reauthorization | No additional fresh-model or cross-vendor trial |
| Safe adaptation | Diagnosis retains changed-meaning safeguards | Broader compatible change and removal challenge |
| Superior economics | No qualifying advantage; diagnostic latency is adverse | Matched strongest-baseline acquisition, reuse and maintenance benchmark |
| Regression/security/holdouts | Current deterministic suites pass; historical failures preserved | Independent-author holdouts/review and hard-memory gate remain unmet |
| Simple installation/DX | Actionable refusal through existing tools and generated interfaces | One-command complete demonstration and unfamiliar-developer trials remain |

This does not complete the seven-act challenge or authorize execution. A structural candidate is not proof that removing a restriction would make it work. Diagnostics may be inconclusive because of search bounds, unknown semantics, missing capabilities or other execution conditions. They do not infer authorization from receipts, probes, descriptions or a peer. Historical evidence remains historical. GraphQL consumers must still interpret returned error/status evidence; no universal remote-adapter containment is established.

Next priorities remain: (1) join environment discovery, a useful public outcome and the protected async effect into the complete reproducible runtime path; (2) freeze that implementation for independently selected unfamiliar cases and matched maintenance economics; (3) finish optional authority installation and live evidence presentation, while addressing the demonstrated containment gaps. Human developer/design-partner/pilot gates require actual external participation.

## Reproduce

From this checkout, using its installed dependencies:

```sh
npm run typecheck
node --test test/planning-refusal.test.ts
npm test
npm run build
```

For an offline comparison, choose new output filenames; the harness refuses overwrites:

```sh
baseline_dir=$(mktemp -d /private/tmp/rcx-planning-baseline.XXXXXX)
git archive e197073475527c8eb1a16ac6e6cdff1284a948cb src package.json | tar -x -C "$baseline_dir"
node experiments/living/planning-refusal.ts "$baseline_dir" /private/tmp/rcx-planning-baseline-result.json
node experiments/living/planning-refusal.ts . /private/tmp/rcx-planning-candidate-result.json
python3 -B experiments/living/check-planning-refusal.py /private/tmp/rcx-planning-baseline-result.json /private/tmp/rcx-planning-candidate-result.json
```

The [raw evidence directory](evidence/planning-refusal/) includes all test logs, comparison records, source hashes and native boundary artifacts. Native protected reproduction uses the already audited Python environment and cached image, as documented in [PROTECTED-WORKFLOW.md](PROTECTED-WORKFLOW.md). It requires the local Docker daemon and disposable loopback resources, not an external protected account.

To reconcile the recorded artifacts without making provider calls, use the Python environment containing the audited Actenon dependencies:

```sh
/Users/ross/src/actenon-audit/.venv/bin/python -B experiments/living/verify-planning-refusal.py docs/adaptive/evidence/planning-refusal-verification.json
```

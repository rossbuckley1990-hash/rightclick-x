# Retained result declarations and saved-goal reuse

Starting revision: `d95f1bc1d289c00ff1b0613447ed74151265a058`. Initial product/harness freeze: `be769c3e0a21488017341b8e8d5684da4ee0a478`. Corrected engineering freeze: **`64bbb1a24ab5bf8adb449d8371981e426752de58`**. Work continues on `programme/adaptive-capability-plane`; the [pre-implementation plan](RETAINED-RESULT-PLAN.md), earlier failures and original acceptance thresholds remain preserved.

The actual warm sessions in the [matched reuse comparison](REUSE-COMPARISON.md) invoked a retained goal successfully, inspected intermediate runs and then composed/published again. That demonstrates extra work, not its cause. This increment supplies bounded historical result information and explicit invocation/reuse guidance through the existing interface. A new live comparison is still needed to establish whether agents use it to avoid redundant work.

## Invariant and implementation

Successful saved execution may retain the chosen plan's declared result shape as advisory knowledge. That knowledge must not become an executable contract, a guarantee about future output values, semantic compatibility evidence, execution authority or proof of successful durable storage.

The change adds 102 and removes three source lines across three files, without dependencies or new tools. `src/core/result-description.ts` follows a selected result through at most eight composite references, records source capability signatures and declared fields relative to that result, and excludes observed-only output keys and caller values. It bounds field entries to 64 and 4,096 serialized UTF-16 characters, and the complete description to 8,192 characters. Unsupported, missing, cyclic or oversized declarations stay unknown. Scalar projections do not invent child fields.

The runtime retains the description only after successful completion, including supported resumed workflows, and only for the innermost active goal. Failed runs preserve the last successful description. Advisory metadata is excluded from the executable goal and goal-definition digest. It therefore cannot change planning, pending-work identity, output values, verification predicates or authority. Portable knowledge export retains its existing explicit whitelist.

Explanations compare the retained description with the current result declaration. Legacy or malformed metadata is `not-recorded`; missing and changed declarations are distinguished. A complete description can report `matches-current-result-declaration`. A truncated description reports only **`matches-retained-result-subset`**: changes to omitted fields are not checked. The initial implementation incorrectly used the complete-match label for both cases. A regression changing field 399 of a 400-field contract exposed this defect; its failing result remains retained and the final source corrects it. The existing noncryptographic capability signature is a comparison aid, not an attestation; field descriptions are also compared.

Additive reuse guidance identifies the saved goal, existing `context_run` invocation and saved restrictions. It distinguishes a configured store from session-only retention, and explicitly states that configuration does not establish a successful durable write. Required input values still come from the caller; current operator restrictions and execution checks still apply. The default explanation and goal run records expose this guidance. Stored predicate paths remain checks, not inferred output guarantees. The thirteen public tool names and input schemas are unchanged; no automatic republication or output-view change is introduced. Actenon and independent execution boundaries are unchanged.

## Frozen replay and measured cost

The harness archives baseline and candidate source from Git, loads the actual retained `warm1-d` and `warm2-d` states and replays their original first saved-goal invocation. Its offline fetch observer accepts only the two exact recorded requests and returns their recorded responses. Each arm runs in a fresh process. A new runtime instance then reloads the updated saved state inside that process; this is not a new model or a separate-process restart test.

All three batches remain retained: an initial four-replay batch concurrent with regression suites, a second four-replay batch after those suite processes ended, and four final replays after the corrected source's validation ended. **All 12 replays produce the same business output, two requests, zero rediscovery, zero new publication and an unchanged 69-capability graph.** Saved definition and publication time remain unchanged; successful-call count advances by one. Complete before/after disclosures, request records, outputs, source/state hashes and process records are retained. The checker removes only the newly added advisory fields before comparing existing baseline/candidate disclosures, including restrictions and verification. A successful output remains `checked`, not promoted to independently verified by this metadata.

| Final replay | Baseline | Candidate |
|---|---:|---:|
| Warm 1 elapsed milliseconds | 3,523.785 | 2,302.349 |
| Warm 2 elapsed milliseconds | 2,570.170 | 4,706.270 |
| Warm 1 post-run explanation bytes | 3,263 | 6,544 |
| Warm 2 post-run explanation bytes | 3,422 | 6,574 |
| Warm 1 run response bytes | 10,427 | 11,229 |
| Warm 2 run response bytes | 13,012 | 13,639 |

Timing is variable and mixed; the initial batch is confounded by known concurrent work. None supplies a speed claim. The added explanation roughly doubles post-run bytes. Explicit projected run responses also grow (1,925 to 2,727 bytes and 1,833 to 2,460 bytes); output projection already existed in the baseline. No new model tokens, total agent cost or avoided tool calls were measured. Both retained public contracts exceed the field budget, so their descriptions explicitly cover only 64 retained fields. Those are declarations, not claims that all fields occurred in the output. No live external requests were made in this checkpoint.

## Validation, failures and audit

The corrected source passes **508 native tests, 79 focused Linux tests and 28 proof checks**, with zero final failures, cancellations or skips. Product typecheck and all four builds pass. Seven new regressions cover saved disclosure, bounded metadata, legacy goals, fresh-runtime state reuse, exact caller projection, nested/scalar results, unavailable/changed declarations, failed execution, privacy, authority denial and declared-versus-observed fields. Existing relevant focused regressions also pass. The first product freeze passed the same suite totals; final logs are separately retained after the subset correction.

Development failures remain recorded: the initial HTTP test fixture omitted required invocation fields; the corrected baseline shows three intended missing-disclosure failures. A later test omitted its provider registration, and the standalone harness typecheck used an invalid `JSON.parse` callback type. Both fixture/harness mistakes were corrected without being scored as product evidence. The genuine truncated-description regression records six passing and one failing test before correction. All concurrent and isolated replay batches remain counted.

The [manifest](evidence/retained-result-manifest.json) binds source, tests, replay inputs, reports and evidence. The [audit](evidence/retained-result-audit.json) reconstructs immutable source hashes and bounded declarations from frozen contracts, checks exact calls and original responses, compares existing disclosures and saved definitions, verifies byte counts, accounts for all processes and validates final suite/proof totals. Three checker tests include twelve altered-result controls and an extra-unaccounted-trial control. This is a separately implemented **same-author** checker, not independent-author review or a sealed holdout.

## North-star coverage and readiness

This advances the disclosure and retention portions of outcomes 4 and 8, with regression evidence for outcome 7. It adds no discovery protocol, semantic binding, asynchronous mechanism, independently enforced authority, cross-vendor transfer or independently verified business outcome. The unrelated controlled fixtures are development regressions, not unseen holdouts. Metadata does not make hidden software discoverable or remove execution boundaries.

Release remains **NO-GO**. The native Darwin hard-memory escape remains unresolved despite current green suites. Independent-author review/holdouts, qualifying strong-baseline economics, cross-vendor evidence, complete deployed route coverage and clean-machine/human/commercial gates remain unmet. The [acceptance matrix](ACCEPTANCE-MATRIX.md), [living plan](LIVING-CAPABILITY-PLAN.md) and [release assessment](RELEASE-READINESS.md) preserve their original criteria.

Next three priorities: (1) freeze the accumulated fixes for a guarded fresh-agent comparison against the existing strong executable-code baseline, counting increased disclosure and all acquisition/reuse costs; (2) obtain independently selected unfamiliar and maintenance scenarios with independent review; (3) address the remaining native hard-resource boundary with evidence of enforcement, without relabelling sampled RSS observation as a hard limit or changing program identity silently.

## Reproduce

Use the evidence commit containing this report; its product source is identical to the final engineering freeze. Existing dependencies and a supported Node runtime are required.

```sh
node --test test/retained-result.test.ts
npm run check
npm run build
npm run proof
python3 -B experiments/living/check-retained-result.py docs/adaptive/evidence/retained-result/paired-final
python3 -B experiments/living/test-retained-result-checker.py
python3 -B experiments/living/verify-retained-result.py docs/adaptive/evidence/retained-result-manifest.json
python3 -B experiments/living/compare-retained-result.py \
  d95f1bc1d289c00ff1b0613447ed74151265a058 \
  64bbb1a24ab5bf8adb449d8371981e426752de58 \
  /tmp/rcx-new-retained-result-pairs
```

Replay output directories must be new. The runner does not switch branches, call models or use the network. Native tests/proof require ordinary local loopback/sandbox access. Proof writes its standard `proof/results/latest.json`; this checkpoint's proof artifacts are preserved separately. Historical manifests reproduce at their own evidence revisions because source and living documents continue to advance.

The 79-test Linux profile uses cached Node 24 image `sha256:5e95a1b7bdb5ddd279c4c18760a007a98f94c6fb24236433c19b61831bc4e4f5`, a read-only checkout, no network, user 65534, no capabilities, no-new-privileges, two CPUs, 512 MiB memory and swap limit, and a 512 MiB `/tmp` tmpfs. Test files are retained-result, disclosure, output-views, workflow-resume, state-format, runtime, goal-satisfaction and planning-refusal. These are local validation results, not a release or deployment.

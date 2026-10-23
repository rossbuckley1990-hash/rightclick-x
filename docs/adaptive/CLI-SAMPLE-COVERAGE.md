# Structured probe coverage and retained goals

This continues the failed real saved-goal experiment in [CLI repair](CLI-REPAIR.md). It does not replace the original North Star objective, unfavorable agent economics, unfamiliar holdouts or acceptance thresholds.

## Diagnosis and change

The investigator asks for two probe variants but supplied only one JSON, XML or CSV document. Its modulo selection repeated that document. A two-file program could also receive the same pair twice; with just one format sample it could receive an unrelated plain-text fallback. These observations cannot satisfy the existing requirement for distinct repeatable inputs. Composition correctly refused the exposed `json_xs` goal.

The correction supplies four generic documents for each structured format: two distinct unary inputs or two distinct pairs. HTML also gets a second pair. The existing two-variant loop and 80-run limit remain unchanged; no application-specific code, acceptance downgrade or automatic promotion is added. Evidence text now reports both run count and distinct-input count accurately. Constant output and only one successful distinct input remain unsupported for composition.

Inspection also showed that the semantic-version migration re-derived remote contracts but left CLI byte-only caches intact. Version **23** now discards stale CLI invocations and dependent crystallized pipelines before attempting bounded re-investigation under current program authority. Denied or unavailable migration leaves those invocations absent. Saved goal anchors are preserved, not silently repinned; if their old operation cannot be re-established, the goal refuses. This incurs acquisition work once on upgrade, and may require a goal to be explicitly re-established. Same-version fresh-process reuse is measured separately. Earlier statements that the version bump alone re-derived all CLI caches were too broad; this checkpoint adds that missing behavior.

The new generic regression file initially failed three of four cases on `f147635`: distinct unary coverage, distinct file-pair coverage and CLI migration. The constant/single-success negative controls already passed. The first patched run exposed a fixture binding error: a JSON value named `document` did not establish the discovered input role named `json`. The fixture now supplies the actual contract port name while retaining the same unseen content, output and dispatch requirements. The 24-test focused suite passed before the final migration-anchor control was added; full verification follows below. All failed logs are retained.

## Frozen replay protocol

Freeze the product, [runner](../../experiments/north-star/cli-goal-samples.ts) and [separate checker](../../experiments/north-star/check-cli-goal-samples.py) before execution. Use the exposed `/usr/bin/json_xs`, disposable authorised aliases, native no-network sandbox and exact same compatible/incompatible wrappers as the earlier experiment. No model or paid resource is involved.

The before source is `f147635`, with semantic version 22. It must still refuse seed goal publication for insufficient distinct evidence. The after source must execute the original 17 fresh-process phases: seed acquisition/publication; direct and saved-goal warm calls; compatible changes and reuse; investigation and execution revocation on both routes; incompatible changes; disappearance; return without discovery; and return after explicit discovery. The goal uses the discovered stdin port name explicitly. A generic JSON type does not by itself establish the intended role among optional JSON ports. That harness amendment is recorded rather than changing the planner's binding rules.

Two additional fresh processes load the actual before-state snapshot using the after source, then reuse the upgraded state. Record all upgrade investigation and timings; require a fresh investigation on version change and zero investigation on subsequent reuse. The initial real goal's failure is retained and is not relabeled a successful baseline.

Every successful task must have one actual target execution, correct raw input/output/identity and an external JSON/pretty-print comparison. All incompatible, revoked, missing and unrelearned-return cases must have zero task executions. Compatible repair must complete in one public call, preserve the pinned operation and stored predicates, and the next process must need zero probes. The runtime grades remain `checked`, not independently `verified`; the external checker does not become a runtime witness. The checker has the same author and is not independent-author review, OS attestation or full semantic proof.

```sh
node experiments/north-star/cli-goal-samples.ts BEFORE_EXPORT f147635 NEW_BEFORE_DIR
node experiments/north-star/cli-goal-samples.ts AFTER_EXPORT AFTER_FREEZE NEW_AFTER_DIR NEW_BEFORE_DIR
python3 experiments/north-star/check-cli-goal-samples.py NEW_BEFORE_DIR NEW_AFTER_DIR
```

## First freeze and additional semantic finding

Freeze `548a0b4` (inference version 23) passed 260 regressions, the 19-process after replay, four checker corruption controls, 28 MCP black-box checks and offline package/install/thirteen-tool/uninstall checks. Its old-source seed still refused correctly. All artifacts are preserved under `evidence/cli-sample-coverage/{before,after}-548a0b4`. An initial build of the source export omitted the demo directory; the missing-file failure and successful build after restoring the frozen demo files are both retained.

The new investigation used 31 probes instead of the previous 30. Reviewing that difference exposed a semantic defect: mode runs on different inputs were all compared with the first default output. A no-op flag therefore appeared to change the output merely because its input changed. The new no-op regression fails on `548a0b4`. The correction compares each mode run with the default's identical input, literal operands, channel and format. Existing true transformations must remain distinct; supported-but-equivalent flags remain available through the documented options interface. The workflow results at the first freeze remain valid within their tested scope, but do not prove all inferred option meanings.

Inference version **24** incorporates that correction and triggers the same authority-checked migration. The second freeze repeated the complete replay and verification, with results below; no original acceptance criterion or task outcome requirement was reduced. Full holdout, authority-boundary, cross-model, economic and human commercial gates remain open; release NO-GO.

## Migration refusal preservation

Freeze `236b4a4` passed 261 regressions, the 19-case replay and six strengthened raw-checker controls, plus 28 black-box checks, package checks and nine targeted Linux sandbox regressions. Its artifacts remain intact. The stronger checker binds task inputs to the frozen cases, state ancestry and saved goal anchors, and rejects a consistently substituted input/output pair or silently repinned goal even when their hashes are updated.

A final migration review then found a direct-call safety defect introduced by dropping the old CLI contract before re-investigation: its old operation identity was also lost. A regression changing a disposable JSON echo program to a constant-result program during an inference upgrade returned the wrong new result as `unverified`. That failed execution is preserved in `migration-meaning-before.log`. Saved goals retained their anchors; the missing protection was for callers of the old direct capability ID.

Version **25** preserves old operation identities across migration and applies the existing changed-meaning refusal after re-investigation. This is deliberately conservative when different inference versions use different synthetic probes: automatic equivalence for old direct IDs may remain unestablished even when the program bytes are unchanged. The original requirement for a successful automatic upgrade is **not relaxed**. The checker now reports any such migration cases as unmet requirements and an overall PARTIAL result, while still requiring zero task dispatch and a changed-meaning reason. Normal same-version lifecycle and reuse must continue to pass. No implicit acknowledgement or repinning is introduced. A future migration proof must establish compatibility rather than discard the old identity.

## Final frozen result

Source, runner and checker freeze **`7d431fb8cf3b6f5da76aaf3f7cc4c259f12d955f`**, inference version 25, yields **PARTIAL**. The original 17 lifecycle cases meet their requirements: eight correct task executions and nine required refusals. Both automatic-upgrade cases remain unmet: they refuse the old operation ID before task dispatch because equivalence across inference versions is unestablished. These two refusals are not counted as successful upgrades. The old-source seed still cannot publish the goal. See the [raw checker result](evidence/cli-sample-coverage/checker-v25.json) and [checkpoint manifest](evidence/cli-sample-coverage-verification.json).

| Check | Result |
|---|---|
| Full native macOS regression suite | 262/262 pass; zero skipped |
| Targeted Linux native-sandbox regressions | 10/10 pass; zero skipped; cached container image, network disabled |
| Product and experiment TypeScript checks | Pass |
| Deterministic MCP/REST lifecycle proof | 28/28 pass; source hashes unchanged and matched to the freeze |
| Separate raw replay checker | 17 required lifecycle outcomes met; two upgrade requirements unmet; PARTIAL |
| Corrupted-record controls | Six rejected: wrong output, dispatch on refusal, hidden network, changed authority, substituted task input, repinned goal |
| Offline package smoke | Build, clean package install, thirteen MCP tools and uninstall pass |

The checker verifies all eight actual task inputs and outputs, not only the runtime's result field. All eleven observed refusals have zero task executions. Saved goal anchors and predicates remain unchanged; current authority and zero network callbacks are checked. Across the 19 fresh processes, seven investigations perform 210 probes. Subsequent same-version direct and goal reuse needs zero probes. Windows and independently operated machines are not tested here. The checker and fixtures share the implementation author; this is reproducible separate checking, not independent-author validation.

Selected measured times, each from one exposed deterministic case:

| Phase | Runtime operation, including state load (ms) | Entire child process (ms) | Probes | Task executions |
|---|---:|---:|---:|---:|
| Seed discovery and goal publication | 676.8 | 795.1 | 30 | 1 |
| Fresh saved-goal reuse | 45.0 | 159.1 | 0 | 1 |
| Compatible change through saved goal | 824.2 | 945.6 | 30 | 1 |
| Fresh reuse after that repair | 49.6 | 171.9 | 0 | 1 |
| Inference upgrade, refused | 728.2 | 855.1 | 30 | 0 |
| Fresh reuse of upgraded state, refused | 18.5 | 135.3 | 0 | 0 |

All 19 after-cases total 6,470.8 ms of runtime operations and 8,726.1 ms of child-process wall time. Those sums include deliberately separate state branches and refusals; they are not a user-workload cost estimate. No model calls or economic comparison were run in this checkpoint. The unfavorable saved-script and Codex comparisons remain unchanged.

To reproduce the replay from this repository without changing branches or existing evidence, export both frozen sources into new directories. Node 24 and macOS's native sandbox are required for this exposed `/usr/bin/json_xs` experiment. The generic targeted Linux tests use the repository's container sandbox setup instead.

```sh
replay_root=$(mktemp -d /private/tmp/rcx-samples-replay.XXXXXX)
mkdir "$replay_root/before-source" "$replay_root/after-source"
git archive f14763550130a67da491ead5171c3c92379ddc42 src package.json | tar -x -C "$replay_root/before-source"
git archive 7d431fb8cf3b6f5da76aaf3f7cc4c259f12d955f src package.json | tar -x -C "$replay_root/after-source"
git diff --exit-code 7d431fb8cf3b6f5da76aaf3f7cc4c259f12d955f -- experiments/north-star/cli-goal-samples.ts experiments/north-star/check-cli-goal-samples.py
node experiments/north-star/cli-goal-samples.ts "$replay_root/before-source" f14763550130a67da491ead5171c3c92379ddc42 "$replay_root/before"
node experiments/north-star/cli-goal-samples.ts "$replay_root/after-source" 7d431fb8cf3b6f5da76aaf3f7cc4c259f12d955f "$replay_root/after" "$replay_root/before"
python3 experiments/north-star/check-cli-goal-samples.py "$replay_root/before" "$replay_root/after"
```

Run these commands from the repository root, with the two experiment files still matching `7d431fb`; the `git diff` check must pass before proceeding. Both scripts resolve Git history relative to their repository paths. The runner records the current harness commit/hashes as well as the frozen product hashes and refuses mismatched source contents. The expected checker result is PARTIAL with `upgrade` and `upgraded-reuse` unmet, not a clean pass.

Next, establish migration compatibility using retained evidence without treating a new fingerprint as permission or silently changing saved intent. Keep changed-program, revoked-authority and unavailable-sandbox controls binding. That work must also cover persisted state versus exported knowledge before a broad upgrade claim. Then measure whether smaller, sufficient disclosure reduces the observed agent overhead and resume the original unfamiliar challenge. This checkpoint removes the real saved-goal sample blocker; it does not establish the North Star release claim.

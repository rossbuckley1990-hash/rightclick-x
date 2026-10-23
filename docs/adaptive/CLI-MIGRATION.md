# CLI inference continuity

This continues the two unmet automatic-upgrade cases in [structured probe coverage](CLI-SAMPLE-COVERAGE.md), without changing the North Star gates or the previous PARTIAL result.

The old and new investigations use different synthetic samples and therefore produce different behavior fingerprints. For the retained real version-22 `json_xs` state, the first old observation also occurs in the new investigation with the same input and output digest. Program bytes and the invocation contract are unchanged. The previous implementation nevertheless refused the old direct operation ID.

## Compatibility rule and limits

Keep both the new fingerprint and the customer's original anchor. An old CLI operation identity may accompany the new contract only when current authorised investigation supplies matching evidence, with all of these conditions:

- Same capability ID, source kind, risk, program bytes and invocation contract, including path, argument order, accepted options, output decoding, file roles and allowed exit codes.
- Same input/output port contract, excluding descriptive prose.
- Every old stored synthetic example matches an example in the new investigation, including its input, file contents, literal operands and output digest. Missing or conflicting evidence refuses continuity.

The inference version remains 25: this changes migration compatibility, not the inference rules or sample generation. Later compatible program repair may retain that lineage only when the current behavior fingerprint and invocation/port contracts still match and the old observations remain present in the fresh evidence. Lineage is persisted locally; saved anchors are not rewritten. A pending refusal for a still older, unproven operation stays refused.

This is bounded observed compatibility, not full semantic equivalence, dependency attestation, exact-action authority or independent outcome verification. It cannot establish continuity when old evidence no longer overlaps, invocation contracts change, or the binary changes during the inference upgrade. A version-25 snapshot that already lost the old evidence retains its refusal; this patch does not invent the missing proof. Current operator authority, program identity and native sandbox checks still apply to every route.

Portable knowledge now uses envelope `rightclick-x/capability-knowledge@2` and declares its inference version. Version-1 envelopes refuse; unknown, older and newer inference versions also refuse before any revalidation or graph mutation. The receiving runtime must not run stale invocation grammars. Same-version import still revalidates current examples under current authority. Local continuity records are excluded on export and stripped on import, including forged records. Automatic cross-version knowledge-bundle migration remains unestablished; a version tag is compatibility metadata, not authentication or evidence of truth.

## Verification protocol

Preserve the initial failing regressions. They exercise a synthetic old snapshot, not an independently selected holdout. The first authority-refusal assertion expected a failed run object when the API instead throws `unknown capability` for a withdrawn operation; the corrected assertion accepts that explicit API refusal while retaining zero task dispatch as mandatory.

Before promotion, run the full regression/typecheck suite, freeze source and tests, then rerun the unchanged 19-process real `json_xs` protocol and its separate checker from the preceding checkpoint. It must now satisfy both original automatic-upgrade requirements, not merely produce passing refusals. Keep all normal lifecycle requirements, exact task inputs and outputs, zero network callbacks, unchanged authority and six corruption controls. Check source-frozen black-box proof, targeted Linux sandbox tests and offline install/thirteen-tool/uninstall. No model sessions, paid resources or comparative score changes are included.

The corrected new tests fail twice on baseline `ffcd831` and the full patched suite passes **266/266**, zero skips. Product/test typechecking passes. One initial baseline export omitted the demo dependency imported by the test helper; that module-not-found run is preserved and is not counted as a product failure. Restoring the frozen dependency produced the two expected baseline failures. Frozen real replay and packaging results follow after execution. All historical adverse economics, missing independent-author validation, unfamiliar holdouts, vendor transfer and human commercial gates remain open. Release NO-GO.

First freeze `06fb51c` passed all 19 lifecycle cases, both previously unmet upgrades, six original checker controls, four supplemental continuity controls, 28 black-box checks, 14 Linux sandbox regressions and offline packaging. A subsequent version-envelope experiment found that adding a profile field inside format 1 was insufficient: the old `f147635` receiver accepted all three capabilities with an unsupported inference version of 999, performing six revalidation runs. That observation is preserved in `evidence/cli-migration/legacy-envelope-before.json`. Format 2 makes older receivers reject the envelope through their existing format guard. The final freeze repeats verification with that correction; the first freeze's result is not a claim of complete version compatibility.

## Final result

Source **`757256fb8204f5721054c36a31eff8435c396610`** passes the original 19-process development replay, with **no unmet replay requirements**. This resolves the two upgrade failures from `7d431fb`; it does not relabel that earlier PARTIAL result. The separate [lifecycle checker](evidence/cli-migration/checker-final.json) verifies ten correct task executions and nine required refusals, with zero task dispatch on every refusal. It rejects all six original corruptions. The [supplemental continuity checker](evidence/cli-migration/continuity-final.json) verifies unchanged bytes, invocation and port contracts, the actual fresh raw probe matching each stored observation, and four more corruptions: wrong alias, expanded options, changed port and invented probe.

The old snapshot contains two copies of one distinct input, not two distinct inputs. Continuity relies on identical binary/contract plus matching fresh observations; this does not retroactively establish old composition support. New composition support comes from the new investigation's distinct samples. The old fingerprint remains `8a71a27dc170a3c7+options+stdout`; the new fingerprint remains `9fbc6a077f90f3cf+options+stdout`. Neither is overwritten, and existing saved goal anchors are unchanged.

| Check | Final observation |
|---|---|
| macOS regression suite | 266/266 pass; zero skipped |
| Targeted Linux sandbox suite | 14/14 pass; zero skipped; cached image, no network |
| Product/test and added experiment typechecks | Pass |
| Frozen deterministic MCP/REST proof | 28/28 pass; source hashes unchanged |
| Offline package | Build, fresh install, thirteen MCP tools, uninstall pass |
| Legacy receiver compatibility | Format 2 rejected with zero accepted capabilities; format 1 previously accepted three under unsupported inference 999 |

Seven investigations perform 210 probes across all 19 cases. Migration takes 664.6 ms for the runtime operation including state load, or 780.6 ms for its child process, with 30 probes and one task execution. Fresh reuse of the migrated state takes 38.9/154.5 ms respectively, with zero probes and one task execution. Compatible saved-goal repair takes 774.2/894.9 ms; fresh reuse after repair takes 48.6/164.9 ms with zero probes. These are single deterministic observations, not agent economics or statistical speed claims. All cases total 6,335.1 ms of runtime operations and 8,599.7 ms of child-process wall time across deliberately separate state branches.

The migrated state is 25,786 bytes versus 24,588 bytes for the earlier refused upgrade. Those different states include both continuity evidence and different run/receipt outcomes; the 1,198-byte difference is not an isolated estimate of lineage cost. The packed artifact is 405,611 bytes. Full model acquisition, disclosure, maintenance and integration costs still need comparative measurement.

The [verification manifest](evidence/cli-migration-verification.json) binds source, tests, raw evidence, failures and reports. Both checkers share the implementation author. There is no independent-author review, live model replacement, unfamiliar holdout, Windows result, new authority-containment claim or economics win here.

## Reproduction and next work

Use the export and replay procedure in [structured probe coverage](CLI-SAMPLE-COVERAGE.md), replacing the after-source revision with `757256fb8204f5721054c36a31eff8435c396610` and using new output directories. The lifecycle runner and checker are unchanged from `7d431fb`. Run the supplemental checker against the same directories:

```sh
python3 experiments/north-star/check-cli-continuity.py NEW_BEFORE_DIR NEW_AFTER_DIR
```

For the envelope experiment, both exported sources must include `src` and `package.json`; run the recorded script with the new source as producer, `f147635` as receiver and a retained upgrade state from the replay. It uses only that fixture's synthetic evidence and disposable authorised program alias:

```sh
node experiments/north-star/knowledge-envelope.ts NEW_SOURCE OLD_SOURCE UPGRADE_STATE NEW_RESULT.json
```

The expected new result is `REFUSED`, with zero accepted capabilities. The old format-1 producer at `06fb51c` reproduces `UNSUPPORTED_PROFILE_ACCEPTED`. The scripts never overwrite existing evidence. Regression, proof and package commands are the repository's existing commands; Linux uses `ci/linux.Dockerfile` and the cached sandbox test image. Inference migration still performs acquisition once; subsequent same-version inheritance does not.

Keep missing-evidence and incompatible-schema migrations refused. Automatic cross-version portable-bundle migration and prior snapshots that have already lost the necessary old evidence remain open. Persisted state retains its existing trusted-local-state assumption; this mechanism does not protect that state from a same-user attacker. Next measure compact sufficient capability disclosure against the actual Codex call/token overhead, then freeze and resume the original independent unfamiliar challenge. Existing Actenon trust boundaries and all commercial/holdout thresholds remain binding. Release NO-GO.

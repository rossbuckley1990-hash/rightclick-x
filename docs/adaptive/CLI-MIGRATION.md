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

Portable knowledge now declares its inference version. Unknown, older and newer versions refuse before any revalidation or graph mutation; the receiving runtime must not run stale invocation grammars. Same-version import still revalidates current examples under current authority. Local continuity records are excluded on export and stripped on import, including forged records. Automatic cross-version knowledge-bundle migration remains unestablished; a version tag is compatibility metadata, not authentication or evidence of truth.

## Verification protocol

Preserve the initial failing regressions. They exercise a synthetic old snapshot, not an independently selected holdout. The first authority-refusal assertion expected a failed run object when the API instead throws `unknown capability` for a withdrawn operation; the corrected assertion accepts that explicit API refusal while retaining zero task dispatch as mandatory.

Before promotion, run the full regression/typecheck suite, freeze source and tests, then rerun the unchanged 19-process real `json_xs` protocol and its separate checker from the preceding checkpoint. It must now satisfy both original automatic-upgrade requirements, not merely produce passing refusals. Keep all normal lifecycle requirements, exact task inputs and outputs, zero network callbacks, unchanged authority and six corruption controls. Check source-frozen black-box proof, targeted Linux sandbox tests and offline install/thirteen-tool/uninstall. No model sessions, paid resources or comparative score changes are included.

The corrected new tests fail twice on baseline `ffcd831` and the full patched suite passes **266/266**, zero skips. Product/test typechecking passes. One initial baseline export omitted the demo dependency imported by the test helper; that module-not-found run is preserved and is not counted as a product failure. Restoring the frozen dependency produced the two expected baseline failures. Frozen real replay and packaging results follow after execution. All historical adverse economics, missing independent-author validation, unfamiliar holdouts, vendor transfer and human commercial gates remain open. Release NO-GO.

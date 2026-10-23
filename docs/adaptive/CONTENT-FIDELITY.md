# Preserve CLI content and exact JSON output

Status: **development defect reproduced and corrected; full mission PARTIAL; release NO-GO**. This is the next product experiment after execution telemetry, on the existing branch. Historical exposed targets remain development data, and no acceptance threshold or historical score is changed.

## Reproduction and change

The measured runner requires the requested input to reach the target. Inspecting historical failures exposed another concrete defect: a CLI input labelled `json` was parsed into a JavaScript value before being serialized back to stdin. On the already exposed `/usr/bin/json_xs` development target, **three of four input forms changed**. Whitespace disappeared, duplicate keys disappeared, and account identifier `9007199254740993` became `9007199254740992` before the program ran. The structured-object control behaved as documented. The [before artifact](evidence/content-fidelity/before.json) preserves actual sandbox input, output and runtime response.

CLI content and literal arguments now preserve strings as supplied. Objects and arrays supplied intentionally still serialize as JSON; named-file maps remain structured inputs. This is a generic wire rule, with no application-specific implementation. The existing input descriptions now explain the text/structured-value distinction.

Output had the same representational hazard: native `JSON.parse` can round numbers, produce infinity, underflow a nonzero value to zero, or discard duplicate keys. A small guard uses the native syntax parser and checks numeric values and object keys before exposing structured JSON. It checks equivalence on JSON serialization, not arbitrary-precision JavaScript arithmetic. Ordinary representable JSON stays structured. Unsafe structured results are refused, labelled refuted and not retried. Numeric/JSON inspection also preserves values that need text instead of reporting rounded data. This does not prove every HTTP/MCP ingress or every external adapter lossless; already-parsed JavaScript values cannot recover original bytes.

For discovered JSON-producing programs, a generic `cli:<provider>:stdout` capability exposes exact standard output as text, with the same underlying invocation, sandbox, operator authority and documented options. It has no inferred structured field projections. It can be retained and revalidated like other learned capabilities. Its successful output remains **unverified** unless an actual outcome check establishes more. A grant or allowlist for a different capability does not automatically authorize this new capability.

Semantic version 20 invalidates prior semantic snapshots using the existing migration mechanism. This deliberate revalidation is not zero-investigation reuse across the runtime upgrade. Reuse measurements below concern capabilities learned under the corrected semantics.

## Evidence and limits

The [development diagnostic](evidence/content-fidelity/with-raw-output.json) preserves all four input forms. Exact stdout equals both the program's observed stdout and the direct sandbox oracle for all four cases. The unsafe integer cannot become a completed structured result. A fresh runtime loading saved state returns the exact new integer `9007199254740995` with **zero investigations**. This is a runtime transfer, not a fresh AI agent or cross-vendor model result.

The separate Python [checker](../../experiments/north-star/check-content-diagnostic.py) imports neither the runtime nor its JSON parser. It uses Python's integer representation to verify the expected large identifiers and exact byte comparisons to check the supplied input and output. It is a separate implementation by the same author, not independent-author validation. A negative control changes the raw result, observed output and oracle to the same rounded integer; the checker must still reject it against the fixture's stated identifier.

Generic regression fixtures cover JSON number precision, overflow/underflow, negative zero, duplicate/escaped keys, nested objects, corrupted syntax, numeric inspection, unchanged CLI bytes, and no retry after representation failure. A disposable JSON byte-counting program demonstrates discovery of the raw capability, persistence, import revalidation and refusal when the operator allows only the typed capability. The first full development suite passed 241 tests with zero skips; the later raw-capability test is included in the frozen suite.

There is a measured decoding cost: on Node 24.16.0/macOS arm64, median checked decoding was 1.42 ms versus 0.14 ms for native parsing at 73,591 bytes, and 14.40 ms versus 1.46 ms at 755,791 bytes (30 samples each). This is a parser microbenchmark, not end-to-end agent economics or a claimed advantage. The raw-output capability avoids structured parsing. Full acquisition, verification, reuse and change costs remain required.

## Reproduction

Use the evidence commit containing this document and its recorded source freeze. A working host sandbox and the already installed `/usr/bin/json_xs` are required for the development diagnostic; tests use generic disposable fixtures.

```sh
npm run typecheck
npm test
node experiments/north-star/content-diagnostic.ts /tmp/rcx-content-new.json
python3 experiments/north-star/check-content-diagnostic.py /tmp/rcx-content-new.json
npm run build
node ci/adaptive-package-smoke.ts
```

Use a new artifact path; the diagnostic refuses to overwrite earlier evidence. Frozen source `50f8c84a31b6c325a37c8d9dc776d097c1a098d7` passed **242/242 regression tests, zero skips**, both typechecks, **28/28 black-box proof checks**, the exact-input/output diagnostic, its separate checker, and offline package/thirteen-tool/uninstall checks. Existing Actenon suites also pass against this freeze: **29/29 containment checks and 20/20 lifecycle checks**, with their original bounded scope unchanged. [Verification and hashes](evidence/content-fidelity/verification.json) bind the raw artifacts. Earlier failed observations remain intact.

## Next acceptance work

A real coding-agent development pilot, fresh independent holdouts, cross-vendor reuse, complete Actenon boundary coverage and independent-author review remain outstanding. The local Claude `/usage` check made no inference (zero tokens and zero reported cost), but did not expose extra-usage enablement. Subscription login alone is insufficient evidence for the no-spending constraint: [Anthropic documents separately billed usage credits](https://support.claude.com/en/articles/12429409-manage-usage-credits-for-paid-claude-plans). No live model session was run in this checkpoint. Continue local product/authority work while establishing a no-charge route; do not invent economic results from these fixtures.

Subsequent checkpoint: the operator confirmed extra usage is disabled. The [development pilot attempt](CLAUDE-DEVELOPMENT.md) then stopped on the weekly limit before inference; its raw refusal is preserved. The [Actenon worker extension](../north-star/evidence/ACTENON-WORKERS-RESULT.md) continues local authority verification without claiming model economics.

# North Star decision: NO-GO on the present product-value claim

**Not yet.** We have implemented a usable, bounded read-only reconciliation API and demonstrated one supported interface migration, with pinned independent checks and fresh-process reuse. We have **not** established that this reduces engineering intervention or total cost relative to maintained integrations. Do not release or sell the current result as a proven integration-maintenance product. Keep the implementation as a reviewable engineering candidate while testing whether a commercially useful problem remains after the checker is supplied.

The strongest counterargument is the checker itself: it already independently retrieves both canonical observations. A customer with that capability may need only a direct comparison. RightClick adds discovery, policy, evidence and retained operation management, but this evaluation does not establish enough incremental value to justify their complexity. This is a reason to stop expanding the platform, not to manufacture additional internal wins.

## Status of the claims

| Classification | Finding |
|---|---|
| **DEMONSTRATED** | The original generic-number goal returns 1 on the frozen source by counting the status string's words. The repaired contract rejects that unrequested derivation before dispatch. Broader scalar/boolean, unused-output and saved-composite controls pass. |
| **DEMONSTRATED** | The product requires operator-owned pinned checks, verifies account/closed period/currency/minor units/basis/safe-integer amounts, returns a legitimate mismatch, blocks known write dispatch at capability and transport boundaries, and does not publish unverified outcomes. |
| **DEMONSTRATED** | An independent fault process removes the REST endpoint and documentation. GraphQL recovery returns a verified mismatch; another OS process reuses the operation for an unseen account with no fallback. The service-side observer confirms unchanged business tables. |
| **DEMONSTRATED** | A delayed persistence writer caused fresh-runtime collisions. The failing regression is retained; draining saves before completion fixes the observed mechanism. Eighteen identical migration runs under six concurrent workers passed after the repair. |
| **DEMONSTRATED** | Maintained static, narrow schema-generated and bounded Codex-only clients achieve the same checked outcomes with the same checker and business obligations. RightClick's D and E configurations use identical witnesses. E takes the deterministic path and uses no model. |
| **CONTRADICTED** | The audit's `__typename` explanation, USD 749,999 loss, measured Codex token/price claim, 6/6 fallback assertion claim, measured 45/30-minute intervention claims and commercial-validation conclusion do not follow from its source/raw report. See AUDIT.md. |
| **NOT ESTABLISHED** | Customer demand, avoided maintenance, total delivery economics, superiority over maintained alternatives, independently sealed case performance, fresh model-agent continuity, served-model attestation and complete engineering-agent billing. |
| **UNSUPPORTED** | Consequential writes through this product mode; prevention/rollback of dishonest external effects; FX/tax/time-zone conversions; arbitrary output-shape repair; rolling-balance consistency; transaction completeness; universal semantic correctness; automatic retirement/replay of uncertain reads. |
| **BLOCKED BY ENVIRONMENT** | Direct live `CodexResponsesFallback` qualification: no legitimately available `OPENAI_API_KEY`. A ChatGPT CLI login is available and was used for a separate model-only control. It is not a substitute for testing the API adapter. |

## Actual implementation and acceptance

`VerifiedReconciliation` reuses the existing planner, independent witnesses, bounded fallback protocol, FileStore and goal leases. It owns its runtime and applies read-only execution policy to every dispatch. Discovery has an additional transport gate: only GET/HEAD, approved exact introspection documents and generated GraphQL Queries are permitted. Generic `RightClick` remains a lower-level API that may return explicitly unverified results and may execute writes under separate operator authority.

The canonical observation has six fields: account, period, currency, unit, basis and amountMinor. Both authoritative and independent secondary snapshots must match the caller's identifiers and expected semantics. The candidate must exactly agree with the independent secondary snapshot. Their safe-integer amounts are compared using integer arithmetic. The returned difference retains currency/unit/basis and carries evidence hashes. This can establish a mismatch without mislabelling it a transport failure or a match.

The unchanged checker contract and operator-supplied rule digest are repeated before publication/reuse. These pins do not attest remote implementation honesty. The fixture checker uses a separate read-only SQLite connection and is never handed the candidate. Production operators need independently maintained data access with consistent closed-period snapshots. That setup and its ongoing maintenance are material product costs.

The last complete local acceptance run passed **843 tests, zero failures and zero skips**. All four TypeScript configurations and the build pass. The existing proof checks passed 28/28, existing negative controls 6/6, and the original stateful exercise passed its 14 events. Original failed evidence and source remain preserved. Independent audit suites were replayed unchanged; their three fallback assertion failures are retained and explained, not counted as passes. A subsequent unthrottled local run hit the existing 50 ms SSE discovery deadline; its unchanged isolated tests pass, and the failed run is preserved. CI, controlled-concurrency results and exact review HEAD are recorded separately.

## Equal-contract comparison and cost

All comparable arms use the same two accounts, closed period, currency, units, basis, read scope, pinned checker and acceptance function. Every arm must establish both a match and a mismatch. The unguarded original graph is a separately labelled negative control, not a safety-equivalent baseline. The static control includes maintained migration-specific code; the generated control actually emits/loads a client from the current schema. Neither represents every commercial static/codegen platform. The Codex control selects a compatible operation under disabled execution tools, has no hidden balance answers, and is independently checked before its result is accepted. It reuses its selection for the second account.

| Path | Observed business result | Model evidence |
|---|---|---|
| Maintained static | Match and mismatch correct | No inference in the measured path |
| Schema-generated client | Match and mismatch correct | No inference in the measured path |
| Codex CLI alone | Match and mismatch correct | One real selection in the completed comparison; 15,813 reported input tokens, 44 output tokens; 0 tool events |
| RightClick with checker | Match and mismatch correct; operation retained | Deterministic, no model |
| Same RightClick with fallback gate | Same checked outcomes | Deterministic, no fallback; **not** a hybrid model success |
| Frozen unguarded graph negative control | Wrong scalar 1, explicitly unverified by runtime | No model; not admitted by the read-only product |

The completed live comparison is `evidence/final-comparison.json`, frozen at `e3110bb689412f58d3ab34575366d84a7823ad72`. It ran alongside acceptance tests: measured two-account elapsed time was about 46 ms for maintained static, 47 ms for codegen and 8,087 ms for the live Codex path. RightClick worker measurements were about 609–1,215 ms **per invocation**, including startup of its runtime, discovery, checks and persistence but excluding OS-process startup. These are one loaded development run, not latency guarantees or a sound basis for savings percentages. Later replay evidence includes parent-measured `processWallMs` and explicitly excludes historical model inference from replay latency.

Across **all three actual CLI attempts**, including both failed harness attempts, reported usage was **47,443 input + 132 output = 47,575 tokens**, with zero reported cached input tokens. Requested model was `gpt-6.1-sol`; the CLI event stream does not attest the served model. First-use CLI prompt bodies were 1,959 bytes while reported input usage was about 15.8k tokens, demonstrating why visible schema size cannot stand in for total agent context. A precise split among system, tool and schema tokens is unavailable.

The API adapter made zero live requests. Actual CLI monetary cost is **unknown**, not zero: no billing receipt was available for the ChatGPT-authenticated runs. Direct SDK model usage is zero for these transactions, but network bodies, discovery, storage, checker operations, engineering and support are real overhead. Full desktop-engineering inference cost, human setup time and avoided intervention were not metered. `evidence/ACCOUNTING.json` lists the known measurements and every missing cost category; no labour estimate is presented as savings.

The live model attempts and raw JSONL are retained. One attempt was initially rejected because a CLI startup warning was classified as a tool event; a regression now distinguishes that exact pre-turn warning while rejecting real tool calls, unknown events, invalid JSON and inconsistent usage. Another report attempt exceeded a git-diff buffer after the model completed; its usage remains in accounting. No failed attempt was overwritten or silently removed from the denominator.

## Gates before revisiting the decision

1. Find a customer who already has trustworthy independent data and recurring supported interface drift, then establish why calling that checker directly is insufficient. If it is sufficient, stop this wedge.
2. Run a read-only shadow pilot against a maintained static/codegen baseline. Measure actual setup, checker maintenance, incidents, intervention, total host/agent cost and outcomes. Do not manufacture drift frequency or willingness to pay.
3. Qualify the real Responses API adapter on externally supplied compatible changes with explicit model identity, validated usage/accounting, proposal admission and fresh-session reuse. Credentials must be separately provisioned; no production money is involved.
4. Freeze source and let a separate evaluator choose new cases. Development fixtures and known Gemini cases cannot become hidden independent tests by renaming them.
5. Resolve release security/operations requirements separately, including business-state retention and uncertain-read handling. No enterprise-readiness or crash-proof durability claim follows from this exercise.

The implementation and evidence are useful engineering work. They do not yet answer the commercial North Star with “yes.”

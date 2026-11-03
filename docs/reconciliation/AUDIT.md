# Audit reconciliation and preserved evidence

Frozen evaluated source: `ebfbf857d5189db44d3043c284c4e89b9e8dcba1`, still a clean detached checkout in the external audit environment. PR #52 remains unmerged. The successor branch starts at that commit.

All eight files in the external `rcx-adversarial-audit` workspace were available and inspected: the five boundary suites, finance suite, master runner and JSON report. Their exact bytes are archived under `external-audit/`; SHA-256 identities are in `evidence/external-input-digests.json`. The separately supplied prose report was also inspected. No full raw Codex transcript from the original finance run was found in that workspace or the named report directory; its JSON contains only a truncated log detail. It cannot establish its claimed usage, model cost or cause of the Codex failure. No missing transcript was invented.

## Confirmed failure and corrected attribution

The original finance fixture and original `want: "number"`, account and settlement intent were replayed against the frozen source. The returned value was **1**, with execution `completed`, verification **unverified**, assurance **unchecked**. Its actual plan was `accountSettlement -> builtin:text.stats`, binding the provider's `state = "settled"` to text and selecting `words`. It did **not** select/count `__typename`.

The contract judge incorrectly treated deriving a statistic as a type conversion. The fix requires a generic numeric/boolean derivation to be requested, required or explicitly anchored, and considers the outputs actually consumed. Unused typed ports cannot justify a selected generic scalar. Legitimate requested counts and tax-rate lookups still work. Saved composites are checked recursively. The unchanged original goal now does not dispatch or produce a result. The generic runtime can still produce unverified outputs; the read-only product will not promote one into a verified business reconciliation without pinned independent checks.

The audit's difference is **749,999 minor units = USD 7,499.99**, not USD 749,999. This read-only case demonstrated an incorrect scalar and a harness business-success interpretation, not an actual financial database mutation. The separate consequential-write suite did demonstrate a committed wrong invoice. That limitation remains: detection is not prevention or rollback.

## Report claims that the source does not support

- Finance Arm C hardcodes input/cached/output token counts and a price calculation after invoking Codex. It combines JSONL with a regex/JSON parse rather than parsing complete events. Its quoted token/cost figures are not observed usage.
- Static/codegen intervention times (45/30 minutes) are literals. The codegen arm fetches a removed document and does not generate a client. These do not measure maintenance effort.
- D and E did not have equal goals/checker access. E's recorded route was deterministic, with no fallback invocation. It is not a hybrid model success. The original agreement compares one amount without independently checking all identity/currency/period requirements.
- The JSON and unchanged replay both report `FALLBACK-ADV-02`, `03`, `04` as **passed:false**, contrary to the prose 6/6. D2/D3 do not force entry into fallback; they return unresolved on a deterministic route. D4 catches a malformed-response rejection but requires an ambiguous billing receipt, even though usage was validated and correctly settled. Settlement of usage is separate from admission of a proposal. These assertions remain unchanged and their failed results are preserved.
- Durable D4 tests absence of a Store, not rejection of an in-memory Store. The general recovery API's old admission accepted writable memory stores. The new reconciliation mode explicitly rejects volatile or unspecified durability and requires leases. FileStore process reuse is tested separately.
- Recovery C4 uses an already incompatible/same-provider checker; it is not a changed-pin lifecycle proof. Separate product tests cover actual pin drift after publication.
- The master report hardcodes several narrative findings and a recommendation. Commercial validation, avoided incidents, savings, willingness to pay and a >95% cost advantage were not established by these fixtures.

## Replay the independent tests unchanged

Do not invoke the archived master runner: it overwrites its report. Run the supplied wrapper, which emits new stdout evidence and leaves original files intact:

```sh
# Map the external absolute imports, including child workers, to a chosen checkout.
export RCX_AUDIT_TARGET="$(pwd)"
export NODE_OPTIONS="--import=$(pwd)/experiments/reconciliation/audit-loader.mjs"
node experiments/reconciliation/replay-audit.ts "$(pwd)/docs/reconciliation/external-audit" > /tmp/rcx-audit-new.jsonl
```

For frozen replay, use a separate checkout of `ebfbf857d5189db44d3043c284c4e89b9e8dcba1` as `RCX_AUDIT_TARGET`, while invoking this wrapper/loader from the successor checkout. Node 24+ is required for the loader. This redirects imports only; no assertion, oracle or fixture is edited. Both frozen and repaired replays are retained. The three fallback assertion failures remain visible and are not converted into passes.

The finance suite is not automatically replayed because its original model runner is unbounded and its accounting is fabricated. The labelled D-only derivative retains its original service fixture and goal while removing other arms/model calls:

```sh
RCX_TARGET=/absolute/path/to/frozen-checkout node experiments/reconciliation/reproduce-audit-finance.ts > /tmp/rcx-finance-frozen.json
RCX_TARGET="$(pwd)" node experiments/reconciliation/reproduce-audit-finance.ts > /tmp/rcx-finance-repaired.json
RCX_TARGET=/absolute/path/to/frozen-checkout node --test test/semantic-derivation.test.ts
```

The last command must fail against the frozen implementation. The same assertions pass against this branch. Engineering-authored regressions and the equal-contract runner are development fixtures, not sealed independent tests. Preserve these known answers and freeze source before a separate evaluator supplies new cases.

## Additional defect found during final validation

Repeated migrations exposed a lifecycle defect in the first product implementation (`324c3088daccfa7f1dddbe4a9e0730e4e00ce80d`): a completed call left an observation save scheduled. A fresh runtime could collide with that stale writer. The direct regression recorded six saves at completion and a seventh afterward. Six of 18 unchanged migration executions failed under six concurrent workers. The correction drains scheduled and queued saves before returning product ownership; all 18 repeated executions then passed. Failure to finish persistence reports ambiguity, never durable success. This is an observed correction, not a universal concurrency guarantee.

The regression can target a separate checkout of that pre-fix implementation:

```sh
RCX_RECONCILIATION_TARGET=/absolute/path/to/324c308-checkout node --test --test-name-pattern='drains scheduled persistence' test/reconciliation.test.ts
```

A report-writer failure was also preserved: hashing an unrestricted `git diff` overflowed its buffer after existing test commands regenerated large evidence files. New test outputs were copied aside and the historical tracked files restored byte-for-byte. Source identities now hash actual implementation files (including untracked source), exclude generated evidence, and are compared before and after an evaluation. A regression checks that multi-megabyte generated output cannot break source fingerprinting.

A final unthrottled local suite run also hit the existing discovery-stream test's **50 ms** transport deadline while other test files were running. Its unchanged source passed all three isolated checks. The failure is preserved as `review-head-unthrottled-sse-timeout.log`; the complete suite is also run with `--test-concurrency=4`. No test deadline, oracle or assertion was changed to obtain a pass. Treat this as a recorded timing sensitivity, not a new SSE-parser diagnosis.

# Accepted work is not a completed outcome

Starting revision: `a2061e77d668b0773d37e83ad56d1cf835e63b6b`, existing branch `programme/adaptive-capability-plane`.

The baseline treated HTTP 202 as completed output. A weak object predicate could label a pending response checked and permit composition to retain it. A peer's pending envelope could also become a completed local result. The four failing baseline controls are preserved in `evidence/http-pending/before-corrected.log`; the first draft is preserved separately.

The correction adds `pending` to run, receipt and witness status. Pending output cannot satisfy predicates, teach identifier bindings, earn successful execution experience, publish or crystallize a new capability. It stops fan-out, repair and alternative planning without replaying the original operation. Saved goals, federation, generated REST (202), generated GraphQL and dashboard assurance preserve the distinction. A pending witness does not refute or verify a business outcome. Receipt/activity history survives restart; it is not yet a resumable execution.

Nine new deterministic controls cover those paths, moved-read repair and an unending response body. Focused regression: **48/48**. Full native regression: **360/360**, no skipped tests, 30.050 seconds. Typecheck passes (`types5.log`). Earlier test fixture typing mistakes and their failed checks remain in the evidence directory.

That first increment is `0276898`. HTTP 202 explicitly leaves processing incomplete ([RFC 9110, 15.3.3](https://www.rfc-editor.org/rfc/rfc9110.html#name-202-accepted)). A Location header alone establishes neither terminal success nor authority.

## Bounded continuation and persistence correction

Continuation product: `c17a76c`. Persistence correction: `408af20`. Frozen final product: **`5ed51aec3ec31e3ded2adb6e40abe8304aa55a69`**, including strict Retry-After validation.

The new generic HTTP profile follows `202` to a known read-only GET monitor, permits further `202` replies, then requires `303 See Other` before reading a known GET result. A direct `200` monitor document stays unresolved. HTTP 303 identifies an indirect response representation; it is not an independent business-outcome attestation ([RFC 9110, 15.4.4](https://www.rfc-editor.org/rfc/rfc9110.html#name-303-see-other)). Normal predicates and separate witnesses still determine assurance.

All follow-ups stay in the original origin and reflected provider. Every target must uniquely match a pre-existing route. Required route parameters come from the exact returned URL; there is no nominal-ID conversion. Unknown paths, ambiguous routes, credentials in URLs, unknown query parameters, cross-origin links, missing parameters and unsupported redirects stop unresolved. No operation or provider is learned during continuation.

Before each GET, the runtime compares the complete relevant contract (including risk and provider), then reapplies execution and network restrictions. The original action's headers are discarded; only the normal origin-pinned credential mechanism applies. Original actions are never replayed by this profile, including after denial, timeout, cancellation or monitor failure.

Defaults are four follow-up requests and twenty seconds after acceptance, with a sixteen-MiB result-body limit and at most 128 eligible routes. Host configuration can disable continuation or set 1–8 requests and 1–30,000 milliseconds. Retry-After is respected; a delay outside the remaining budget stops without waiting. Transport/body deadlines and host-API cancellation leave an explicit pending outcome. Local action/contract digests and HTTP statuses are included in the existing receipt hash chain and bounded activity history. They are not cryptographic authority grants or independently signed receipts.

The initial full candidate regression failed **372/373** with an `ENOENT` rename in the existing FileStore. Two dedicated controls then reproduced overlapping-save and mutable-snapshot defects. Saves now capture input at call time, serialize within an instance and use exclusively created unique staging files. The four focused store/CLI tests pass. Multiple independent writers remain last-writer-wins; no distributed transaction or crash-durability guarantee is claimed. All failures remain in `evidence/http-pending/`.

A final protocol review reproduced another defect: JavaScript interprets the malformed Retry-After value `0.5` as a date, allowing immediate polling. The preserved control fails on `408af20` and passes after the parser requires an integer delay or a valid IMF-fixdate. Obsolete HTTP date forms are conservatively unsupported. Past and future valid dates have separate controls.

## Evidence and measurements

| Check | Frozen result |
|---|---|
| Full native regression | **375/375**, zero skipped, 35.450 s |
| Focused Linux, cached image, network disabled | **76/76**, zero skipped, 0.742 s |
| Typecheck and Node/edge builds | PASS |
| Existing proof suite | **28/28** |
| Existing Actenon lifecycle | **23/23**; separate checker verifies 22 exact-request proofs and 29 signed artifacts; four corruption controls rejected |
| New pending / continuation / storage controls | **9 / 13 / 2** tests, included in the above suites |
| New local HTTP lifecycle | Both cold and new-input fresh-process results pass separate resource/transport/receipt checks |
| Lifecycle checker negative controls | Six rejected: wrong result, wrong intermediate, duplicate effect, hidden discovery, reused PID, altered receipt |

The lifecycle experiment uses real loopback HTTP with two controlled service families. An operator-approved catalog advertises rendering and character-count contracts. `context_research` discovers both, the normal planner composes them, the renderer completes through the supported asynchronous profile, and its result becomes the counter's input. The caller supplies task anchors and outcome predicates, but no reflection objects, mappings, polling code or intermediate identifiers.

Cold execution made three discovery reads and five execution requests. Reuse in a new process made five execution requests and **zero discovery requests** on a different input. Resource state records exactly two render effects across both invocations, with no replay. Graph size was 26 in both processes. Final measured worker times were 202.418 ms cold and 434.715 ms reused; observed RSS was 75,076,504 and 71,995,664 bytes. These single samples were collected while regression and Actenon work ran on the host and exclude process startup. Reuse was slower in this sample: no economic speedup is established. The earlier `408af20` trial is also preserved (34.032/20.298 ms), illustrating why these timings are not a matched benchmark.

The identical task on frozen `0276898` stopped pending after the first effect: it could discover and plan but could not complete or retain the workflow. That failed baseline is preserved. The final implementation completed it and reused it. This demonstrates improvement over the frozen runtime, **not** a win over a strong coding-agent baseline.

The checker is a separate Python implementation comparing resource state, input/output bindings, effect counts, discovery traffic, process identity and receipt hashes. It has the same author as the implementation. These exposed development cases are not sealed holdouts. Existing public-service evidence in [LIVING-PUBLIC.md](LIVING-PUBLIC.md) remains historical evidence; no external asynchronous provider was tested at this checkpoint.

## Requirement coverage and remaining limits

| Mission phase | Coverage after this increment |
|---|---|
| 0 real baseline | Existing reconstruction preserved; same isolated branch, starting `a2061e7`, frozen product `5ed51ae` |
| 1 environment discovery | Existing catalog mechanism now feeds the asynchronous multi-provider lifecycle; other discovery families remain open |
| 2 representation | Pending/assurance distinction propagated through all supported execution faces; arbitrary unfamiliar semantics remain unresolved |
| 3 dataflow | Existing typed planner correctly connects these producer/consumer outputs; no new arbitrary URL/ID mapping or general join claim |
| 4 stateful execution | **PARTIAL**: bounded 202/303 profile, explicit unresolved states, cancellation and no write replay; no durable continuation/resume |
| 5 closed loop | Saved goal reuse, contract/risk-change refusal, denial, rate-limit/unavailability distinction and persisted observations; no automatic alternative around pending work |
| 6 generality | Controlled development tests and separate checker pass; independent-author unfamiliar holdouts and real external asynchronous services remain unestablished |

In particular, interruption loses active polling progress. Receipts retain historical pending state, but there is no safe resume handle; calling the original operation again is a new action, not a resume. APIs with `200` status objects, body-specific state machines, cross-origin monitors, extra required header inputs or no discoverable GET contract remain unresolved. The runtime does not infer semantic completion from arbitrary status names.

The existing Actenon regression confirms compatibility of the prior protected lifecycle. **It does not demonstrate exact-action grants for this new asynchronous follow-up profile.** Local runtime restrictions do not contain alternate shells, direct APIs, leaked credentials or other runtimes. A protected deployment must independently authorize each exact follow-up and eliminate alternative resource routes. No new Actenon dependency or cryptographic implementation was added.

Release remains **NO-GO**. The historical native memory-containment escape is unresolved despite this green regression run. Fresh-model inheritance, independently selected holdouts, the complete seven-act/headline demonstration, strong-baseline economic advantage and required human commercial validation remain open.

Next three changes: (1) protected asynchronous reconciliation and durable resume with fresh exact-action authority; (2) contract-evidenced dataflow relationships for unfamiliar interfaces, including ambiguous-ID refusal; (3) frozen independent holdouts and matched fresh-agent maintenance/reuse measurements, preserving current failed baselines.

Reproduce from this checkout:

```sh
npm run typecheck
node --test test/http-pending.test.ts test/run-drift.test.ts test/outcomes.test.ts test/interface.test.ts test/fanout.test.ts test/execution-policy.test.ts
npm test
npm run proof
npm run build
node experiments/living/async-lifecycle.ts run "$PWD" /tmp/rcx-async-new
python3 experiments/living/check-async-lifecycle.py /tmp/rcx-async-new --negative-controls
```

Run from the engineering checkout with dependencies already installed; the HTTP experiment needs permission to bind loopback and requires a new output directory. It checks that product source matches its recorded Git revision. The source/artifact manifest and reconciliation command are `evidence/http-pending-verification.json` and `python3 experiments/living/verify-http-evidence.py docs/adaptive/evidence/http-pending-verification.json`.

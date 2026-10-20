# Accepted work is not a completed outcome

Starting revision: `a2061e77d668b0773d37e83ad56d1cf835e63b6b`, existing branch `programme/adaptive-capability-plane`.

The baseline treated HTTP 202 as completed output. A weak object predicate could label a pending response checked and permit composition to retain it. A peer's pending envelope could also become a completed local result. The four failing baseline controls are preserved in `evidence/http-pending/before-corrected.log`; the first draft is preserved separately.

The correction adds `pending` to run, receipt and witness status. Pending output cannot satisfy predicates, teach identifier bindings, earn successful execution experience, publish or crystallize a new capability. It stops fan-out, repair and alternative planning without replaying the original operation. Saved goals, federation, generated REST (202), generated GraphQL and dashboard assurance preserve the distinction. A pending witness does not refute or verify a business outcome. Receipt/activity history survives restart; it is not yet a resumable execution.

Nine new deterministic controls cover those paths, moved-read repair and an unending response body. Focused regression: **48/48**. Full native regression: **360/360**, no skipped tests, 30.050 seconds. Typecheck passes (`types5.log`). Earlier test fixture typing mistakes and their failed checks remain in the evidence directory.

This is a semantic-correctness increment, not asynchronous completion support or independent business verification. HTTP 202 explicitly leaves processing incomplete ([RFC 9110, 15.3.3](https://www.rfc-editor.org/rfc/rfc9110.html#name-202-accepted)). Continuation needs separate protocol evidence and fresh execution checks; a Location header alone establishes neither terminal success nor authority.

Reproduce from this checkout:

```sh
npm run typecheck
node --test test/http-pending.test.ts test/run-drift.test.ts test/outcomes.test.ts test/interface.test.ts test/fanout.test.ts test/execution-policy.test.ts
npm test
```

Tests use controlled development providers. No independent-author holdout or economic advantage is claimed. The existing native memory-containment failure and other release gates remain open.

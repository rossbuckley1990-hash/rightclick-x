# Offline process inheritance acceptance

Run `node --test experiments/inheritance-offline/acceptance.test.ts` from the repository root. This test uses synthetic, deterministic subprocesses; it never starts a model or opens a network listener.

One process learns two OpenAPI contracts from a fetch test double, publishes a witnessed goal, and persists the state. The test copies that state to another file and launches a fresh process that discovers and executes it on a different input. It asserts that the stored witness is called. Another process has a network origin denied and cannot verify through the witness. Further fresh processes re-learn version-changed fixture contracts and exercise a compatible metadata-only version bump, a witness returning false, and a removed witness operation.

The test harness also invokes `/usr/bin/shasum` on the inherited output, if present, and compares it to a fixed expected SHA-256. This is an externally computed local oracle run by the test harness, not real software invoked as a RightClick capability. If the program is absent the oracle is explicitly reported as unavailable in optional evidence; the other assertions still run. The harness does not disable RightClick's CLI sandbox or run a RightClick CLI capability.

The intended outcome is deterministic evidence of state transfer, execution, current egress enforcement, and replay of a saved obligation. It is **not autonomous AI discovery**, not a cross-vendor agent test, not production security isolation, not a real external service invoked by the runtime, and not independent-author review. The producer and witness are distinct fixture operations, but the same code and author supply the truth; a malicious or wrong oracle is not ruled out. The compatible change is metadata-only, not a claim of recovery from a protocol or structural change.

To save the synthetic runtime artifacts and invocation summaries for later review, provide an output directory:

```
RCX_OFFLINE_EVIDENCE=/path/to/new/evidence node --test experiments/inheritance-offline/acceptance.test.ts
```

The state includes synthetic inputs and local receipt chains; those receipts are kept by the same runtime process and are not independent attestation. The optional output is overwritten by a later run. The test creates no model sessions and consumes no model usage.

## Historical freshness failure and current regression

`node experiments/inheritance-offline/stale-publication-repro.ts` checks a
separate, model-free case: two runtimes load a saved goal, one durably replaces
it, and the other tries to execute its already-loaded definition. On commit
`d6d7a4a`, the old definition executed successfully, so the command reports
`FAIL_STALE_DEFINITION_EXECUTED` and exits 1. That result describes the old
commit, not the current integration. The current cooperative FileStore lease
checks the saved definition under the publication lock before dispatch, so the
same reproducer should report `STALE_DEFINITION_NOT_EXECUTED`. It does not
protect against older running runtimes or other writers that ignore the lock;
see `GOAL-LEASE-SCOPE.md`. This case is separate from the fresh-process
acceptance test above.

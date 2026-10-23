# Independent authority on remaining workflow effects

**Partial milestone; North Star release remains NO-GO.** This continues the existing branch from `f5032677bb364ee7c70461c49533de56f773b3f9`. The experiment and checker freeze is `8ea708eaecc94995aa8a0dd561ff16a04b2bba2e`. Product source, CLI and tests are unchanged from the [retained workflow implementation](WORKFLOW-RESUME.md), `07a10f09`. The preceding turn was verified progress; this increment checks its previously unproven independent execution boundary.

## Demonstrated behavior

An ordinary catalog advertises a compression service and digest publication operation. RightClick reflects the contract and its existing planner selects a two-step route. The development client materializes that selected route as a retained composite through the SDK; this is not yet general `context_compose` recovery.

The first step enqueues a real background gzip job. The client stops at its polling budget and exports its bounded runtime state. Fresh network-disabled containers then exercise:

1. A changed remaining target: the retained contract digest refuses recovery before any request.
2. Revocation while pending: recovery stays unverified and reaches no protected effect.
3. New operator authority: recovery reads the original result and publishes its digest exactly once, with a fresh exact-action proof for the remaining POST.
4. Publication authority withheld: the job result is observed, but the remaining POST is refused and the workflow fails unverified.
5. Revocation after result read: the result GET succeeds, the operator revokes the grant, and the following publication POST is refused. The runtime does not replan or repeat the enqueue.

All resume processes make zero catalog/contract requests and zero enqueue requests. The successful parent and child checkpoints are removed. Three jobs create three gzip artifacts, each independently decompressed against its original authorized document. Only the first workflow publishes successfully.

A separate native proof control then publishes the previously refused `generated` artifact under explicit new operator authority. This is **not** a recovered workflow success. Final evidence contains five committed effects: three enqueues, one workflow publication and one native-control publication.

## Exact actions and bypass coverage

The existing native Actenon issuer, gate, replay store, revocation checker, effect reservation and signed outcome APIs are reused. No authority implementation or new dependency is added to product source. The operator-controlled issuer checks bounded exact request bodies and targets; native proofs bind the request actually received by the resource.

The resource service owns the only effect sink and observed TCP listener. Its publication handler executes inside the same native gate as enqueue, monitor and result operations. There is no raw backend listener. The issuer's private keys/store/socket and provider files are outside the untrusted client's sole read-only mount.

Mutation controls change method, target, query, body and headers while retaining a proof. All refuse with the corresponding native mismatch reason. A forged signature refuses. An unchanged publication proof executes once; replay refuses. Native effect reservations for all five effects are observed committed.

A separate network-enabled container proves it can reach public metadata, then attempts the publication route, aliases, changed methods and protected reads without authority. Direct HTTP, shell and raw-socket requests refuse. Duplicate-header and transfer-encoding controls refuse ambiguous framing. The container has no discovered credentials, Docker socket or authority store.

These observations cover the controlled resource and tested routes. They do not establish universal execution visibility, arbitrary filesystem containment, hostile same-user host isolation, remote federation or every generated endpoint. The trusted host/Docker daemon, operator issuer and resource process remain outside the adversary boundary. General deployment and released version compatibility remain open.

Issuer-side refusals in the workflow scenarios have no provider response and are unsigned. Resource-side receipts and refusals are signed and verified separately. A native authority proof authenticates authorization; artifact bytes and publication contents establish the business result independently.

## Verification and measurements

The separate Python checker imports native public-key verification APIs, not RightClick or the experiment harness. It reconciles raw client reports, requests, grant transitions, exact proof bindings, compressed files, publication files and signed artifacts. It distinguishes the later native-control publication from workflow success. Five corrupted evidence copies—publication, artifact, extra effect, proof and attestation—are rejected.

| Check on `8ea708ea` | Result |
|---|---|
| Protected remaining-workflow experiment | **28/28** |
| Separate verifier | One successful workflow, two refused remaining effects, three jobs, two publications including one separate native control |
| Exact successful proofs / signed resource artifacts | **14 / 50** |
| Corrupted evidence copies | **5/5 rejected** |
| Existing protected asynchronous regression | **29/29** |
| Existing async native verifier | Seven files, 22 exact successful proofs, 60 signed artifacts; five corruptions rejected |
| Native regression suite | **409/409**, zero skips; 30.011 seconds |
| Typecheck | PASS |
| Retained source/artifact reconciliation | **PASS**: 138 source files, 401 artifacts; both native checkers rerun |

The previous 96-case Linux suite, 28-check proof and bundle builds remain bound to `07a10f09`; they were not rerun here. The product/CLI/test/config source comparison against that revision is empty. The current Actenon experiments run actual fresh Linux containers against the changed experiment code.

Selected final-run measurements:

| Fresh process | Wall time | RSS |
|---|---:|---:|
| Discovery plus no-grant refusal | 361.328 ms | 65,671,168 bytes |
| First enqueue and pending checkpoint | 575.880 ms | 80,896,000 bytes |
| Changed-target refusal | 520.874 ms | 64,307,200 bytes |
| Revoked pending recovery | 703.496 ms | 65,097,728 bytes |
| Authorized recovery and publication | 579.088 ms | 65,974,272 bytes |
| Publication authority refused | 987.615 ms | 65,843,200 bytes |
| Revocation between steps | 1,013.056 ms | 65,773,568 bytes |

Discovery reports 25 capabilities/two providers including built-ins; materializing the retained composite makes 26/three. These counts describe the tested graph, not authorized operation coverage. Times include container startup, IPC and provider polling and overlap regression work. They are single controlled observations, not a matched benchmark or speedup.

## Preserved trials and limits

Evidence lives under `docs/adaptive/evidence/protected-workflow/`. `attempt1` failed before execution because the command contained a mistyped cached-image digest. The runner refused image inspection and never pulled. `attempt2` passed the initial 27 controls; `attempt3` added committed-effect reconciliation and passed all 28 plus native checking. The final run repeats those controls against the committed source.

No acceptance threshold was weakened. No product-specific branch was added to the runtime. This remains a deliberately developed provider and operator fixture; it is excluded from future unfamiliar holdouts. The checker is a separate implementation by the same author, not independent-author review.

Fresh container state transfer is tested here. The real SIGKILL/FileStore scenario remains separately established by the previous workflow tests; this experiment does not combine a process kill with the native boundary. Publication-file and journal crash atomicity, power-loss durability, multi-host checkpoint races and uncertain final publication reconciliation remain unestablished. The native hard-memory containment failure remains unresolved.

## Acceptance and next work

This adds bounded evidence for original outcome 3 and preserves the outcome/retention/refusal properties of outcomes 2, 4, 5 and 7. It closes the specific “remaining workflow steps have not been exercised under native authority” development gap for this profile. It does not close any original broad release gate.

The commercial proposition gains a demonstrated ability to preserve operator restrictions across deterministic recovery. Whether that saves more engineering or incident cost than an equally protected coding-agent/script baseline is unknown. The adverse saved-script benchmark remains authoritative.

Next three priorities:

1. Extend retained execution through the normal compose/saved-goal paths while preserving the chosen plan, egress limits, witnesses and authority obligations.
2. Freeze before independently selected unfamiliar software and actual fresh-model inheritance; combine crash recovery and independently enforced remaining effects.
3. Measure acquisition, recovery and maintenance costs against the strongest equally protected baseline, then simplify installation around demonstrated value.

## Reproduce

Use the pinned Actenon environment and cached image documented in [the experiment README](../../experiments/actenon/README.md). The runner refuses an existing evidence directory, checks source pins and creates only disposable local resources.

```sh
/absolute/audit-root/.venv/bin/python experiments/actenon/workflow.py \
  --image sha256:5e95a1b7bdb5ddd279c4c18760a007a98f94c6fb24236433c19b61831bc4e4f5 \
  --output /absolute/new-protected-workflow-evidence
/absolute/audit-root/.venv/bin/python experiments/actenon/check-workflow.py \
  /absolute/new-protected-workflow-evidence
npm run typecheck
npm test
```

The [evidence manifest](evidence/protected-workflow-verification.json) and [recorded reconciliation result](evidence/protected-workflow-verification-result.json) additionally verify saved source/artifact integrity without executing a provider or model. Recheck with:

```sh
/absolute/audit-root/.venv/bin/python experiments/living/verify-protected-workflow.py \
  docs/adaptive/evidence/protected-workflow-verification.json
```

There was no merge, push, publication, paid service, model call or external provider mutation.

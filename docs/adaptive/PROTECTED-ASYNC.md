# Protected asynchronous execution checkpoint

**Partial engineering milestone; release remains NO-GO.** On the existing `programme/adaptive-capability-plane` branch, work started at `6094af20511ba26151c2627f335108b2ae1ecfbb`. Product and experiment code are frozen at **`4a03f7b36222ad4c680fab9ae5a5b1e0a9d59e50`**. Main, releases and other worktrees were not changed. No model, paid service, deployment, push, merge or publication was used.

This extends the [generic HTTP continuation](HTTP-PENDING.md) and the existing [Actenon source assessment](../north-star/evidence/ACTENON-INTEGRATION-FEASIBILITY.md). It does not replace the original Master Specification, independent holdouts, strongest-baseline comparison or commercial gates.

## Invariant and implementation

An execution-boundary refusal ends the current execution attempt. It does not become behavioral evidence that the provider is broken, cause contract rediscovery, select another plan, or publish a capability. If the original request was already accepted with HTTP 202, a denied follow-up leaves its outcome **pending and unverified**. The original action is never replayed by this continuation profile.

`TransportRefused`, exported from the existing SDK, is a small host-transport stop signal. Direct runs, saved goals, composites, fan-out, witnesses, peer results and generated REST/GraphQL propagate it. Standard HTTP 401/403 responses also stop OpenAPI, GraphQL, MCP and peer execution. Responses are disposed of without interpreting their bodies as authority evidence. A peer's refusal can stop local work but cannot supply local grant identity or authorize an action. No tools were added: the thirteen `context_*` tools remain.

The marker is not enforcement, a signature, a grant, a credential broker or proof of resource coverage. An optional host adapter may throw it when an independent broker refuses. The resource-owned Actenon gate supplies enforcement in the experiment. RightClick contains no copied Actenon cryptography and acquires no Actenon runtime dependency.

Before extending the experiment, the pinned Airlock effect, broker and reconciliation source/tests were inspected. The selected upstream tests pass **46/46**. Actenon already distinguishes exact transport execution, effect reservation and trusted ambiguous-outcome reconciliation. Enqueuing a job can be committed while its business result remains unknown. These mechanisms are reused, not reimplemented.

## Reproducible controlled path

The operator advertises one local RFC 9727 catalog. Ordinary environment discovery fetches its OpenAPI contract and reflects four operations. No agent supplies their descriptors, polling code or a product-specific transformation. A declared digest output lets the existing planner select the result projection.

The sole resource service creates a real background Python process that compresses the supplied document with gzip. It returns 202 with a monitor location; the monitor returns 202 while the child is running and 303 to a known result route when it exits. The result contains the artifact digest. The same normal discovery, graph, planner, continuation and saved-goal code executes the workflow. A new isolated Node container reuses the saved goal with a different document and **zero metadata requests**. The generated REST endpoint follows the same boundary.

The operator, outside the agent container, controls grants and exact target/body limits. Every accepted HTTP request has native Actenon proof checked by the resource itself. The service has its own receipt key, the issuer public key and a private authority socket; it does not receive the issuer signing environment. Agent containers have no network, private store, issuer key, writable source or Docker socket. A separate network-enabled container demonstrates that bypassing RightClick still encounters the resource gate.

Controls include no grant, denied monitor, denied result, unapproved moved result, revocation during polling, altered method/target/query/body/headers, forged signature, replay, direct HTTP, shell, raw TCP, unlisted routes and ambiguous HTTP framing. Direct artifact reads are refused even when the artifact exists.

The separate Python checker imports native public-key verification APIs, not RightClick or the experiment harness. It verifies signatures and exact successful-request binding, matches edge decisions to received requests, checks resource journal-prefix commitments and decompresses the artifact bytes. It reconciles the three returned digests with actual files, verifies that four unresolved client outcomes stay pending, and rejects five corrupted evidence copies. This is independent process/implementation checking by the **same author**, not independent-author evaluation or certification.

## Final results

Raw final evidence is under [evidence/protected-async/final](evidence/protected-async/final/result.json); the [checker result](evidence/protected-async/checker-final.json) and historical failures are retained beside it.

| Check | Observed result |
|---|---|
| Full native regressions | **384/384**, zero skips, 25.445 s |
| Focused Linux regressions | **74/74**, zero skips, cached image, no network, 3.466 s |
| Type check and both bundles | PASS |
| Existing black-box proof harness | **28/28** |
| Upstream selected effect/reconciliation tests | **46/46** |
| Protected asynchronous experiment | **29/29** |
| Existing resource-owned baseline | **36/36**, 45 signed artifacts checked; all 45 altered artifacts rejected |
| Existing adaptation/federation lifecycle | **23/23**, 22 exact request proofs and 29 signed artifacts checked; four corrupted evidence sets rejected |
| New separate artifact checker | Seven correct compressed files, seven enqueues, three returned business results, four honestly unresolved client outcomes |
| Native boundary evidence | 22 unique successful request proofs; 28 valid historical proof records including negative controls; 60 signed receipt/refusal artifacts |
| New evidence corruption controls | Wrong file contents, extra effect, missing request, altered proof and forged attestation all rejected |

Discovery covers **one of one deliberately advertised eligible sources**. Four operations are reflected; three operation kinds actually execute through approved routes. The moved artifact route is known but unapproved. This is not environmental inventory recall, an unfamiliar-provider holdout or a claim that every reflected operation was executable.

Final observed costs:

| Phase | Container wall time | RSS | Graph size | Transport requests |
|---|---:|---:|---:|---|
| Discovery plus refused no-grant attempt | 216.565 ms | 65,572,864 bytes | 24 capabilities / 2 providers | Two metadata reads and one refused job request |
| First execution and retention | 1,280.640 ms | 82,489,344 bytes | 25 / 3 | One enqueue, two monitor reads, one result read |
| Fresh-process reuse, new document | 1,254.975 ms | 65,908,736 bytes | 25 / 3 | Same four execution requests; zero discovery |

Graph counts include built-ins and the generated goal provider. Twenty-six broker transport samples have median 3.639 ms, including proof issuance, IPC/resource dispatch and local observation; this is not isolated cryptographic overhead. Container times include startup and the provider's one-second polling advice. Runs overlapped other checks. No matched coding-agent baseline was measured here, and no economic advantage is claimed. The earlier equal-control saved script remains faster.

## Preserved failures and corrections

All trials remain in `evidence/protected-async/`:

- `attempt1`: the previous IPC client equated success with HTTP 200 and discarded a genuine 202 after the resource had enqueued work. Corrected bridge behavior preserves HTTP status/headers/body and only throws typed refusal when no response exists. It never replays the accepted request.
- `transport-before.log`: two baseline failures show an untyped broker rejection being treated as provider failure/repair evidence.
- `transport-attempt2.log`: six of seven tests passed; the first witness test incorrectly used the producing provider as its observer. The corrected test uses a separate provider and checks that later witnesses stop after denial. No independence requirement was relaxed.
- `http-denial-before.log`: both new HTTP 401/403 controls failed on the intermediate product. They pass after the protocol-general denial correction.
- `proof-sandbox-failed.json`: the first proof run could not bind its loopback listener (`EPERM`). The authorised local rerun passes. This was an execution sandbox limitation, not an approval rejection.
- `checker-attempt1.log`: the checker initially assumed a separate revocation log; the actual journal contains two grants and a revocation event together. Corrected parsing checks that exact sequence.
- `linux1.log`: 62 tests ran because an explicitly named environment test file did not exist and Node omitted it. `linux2.log` includes the correct file; final Linux validation includes it and both added HTTP controls. Missing coverage was not counted as passing.

Intermediate `attempt2`, `attempt3`, `attempt4` and `frozen` directories are development evidence. The final replay uses committed `4a03f7b`; exposed cases stay excluded from future holdouts.

## Coverage and remaining limits

| North Star area | This checkpoint establishes | Still required |
|---|---|---|
| Environment-native discovery | Approved catalog → ordinary contract → executable async operation | Additional advertised protocol families, sealed eligible-source coverage |
| Semantic interoperability | Existing declared digest projection used without provider-specific runtime code | Generic new dataflow gaps and unrelated final holdouts; no new semantic inference claim here |
| Async execution | Bounded 202/303 continuation with exact independently authorized follow-ups | Durable interruption/resumption, other documented async profiles, cancellation/reconciliation across crashes |
| Reuse | New input in a fresh deterministic container, no discovery or stored authority | Actual fresh-model transfer and full seven-act challenge |
| Adaptation/authority | Changed follow-up target or revoked grant stops; prior 23-case lifecycle still passes | Multi-host/principal federation and deployment-wide route coverage |
| Outcome verification | Correct compressed bytes checked outside the runtime; pending is not reported completed | Independent-author oracles and unfamiliar business outcomes |
| Security/release | Bounded resource gate and terminal-denial regressions | Native hard-memory escape remains unresolved; supported released Actenon stack, credential custody and independent review |
| Developer economics | Measured complete local path and zero-discovery reuse | Strongest matched baseline advantage, simple optional install, five developer trials, three design partners and paid-pilot evidence |

The controlled service is authored for this experiment. The trusted host, same-user operator processes and Docker daemon are outside the attacker boundary. No arbitrary existing application's direct APIs, shell credentials, aliases, alternate tools or remote runtimes are claimed contained. Proof/refusal checks are historical; they do not renew expired grants. Operator/before-parse refusals are not all signed. Seven observed enqueues do not establish general exactly-once execution. The runtime still has historical pending receipts rather than a durable continuation API. Public-provider evidence remains the separate [RCSB/Crossref checkpoint](LIVING-PUBLIC.md), not a new external-service run here.

## Reproduction

Use the pinned source environment and cached Docker image in [experiments/actenon/README.md](../../experiments/actenon/README.md). The integration reproduction currently requires macOS `lsof`, Docker Desktop host access, Python 3.12 with the five audited packages and Bun. It is not the requested simple installation experience.

From a checkout of product revision `4a03f7b`, with the later evidence/checker commit available:

```sh
npm run typecheck
npm test
npm run build
npm run proof

/absolute/audit-root/.venv/bin/python experiments/actenon/protected-async.py \
  --image sha256:5e95a1b7bdb5ddd279c4c18760a007a98f94c6fb24236433c19b61831bc4e4f5 \
  --output /absolute/new-protected-async-evidence
/absolute/audit-root/.venv/bin/python experiments/actenon/check-protected-async.py \
  /absolute/new-protected-async-evidence

/absolute/audit-root/.venv/bin/python experiments/living/verify-protected-async.py \
  docs/adaptive/evidence/protected-async-verification.json
```

The experiment refuses an existing output directory and verifies all five Actenon source pins before use. It creates disposable local keys/grants and removes private state and containers afterward. The final command checks the retained checkpoint evidence without starting services; it requires source files matching the recorded product revision.

The next three engineering priorities remain: (1) durable, authority-rechecked continuation and explicit reconciliation without original-action replay; (2) freeze the generic implementation and obtain independently selected multi-provider dataflow/async holdouts with actual fresh-model reuse; (3) measure acquisition and maintenance against the strongest equally protected baseline, then simplify installation only around demonstrated value. The original security, release and human commercial gates remain unchanged.

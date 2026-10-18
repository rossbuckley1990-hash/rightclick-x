# Bounded RightClick X / Actenon development experiment

2026-10-18. **Partial architectural evidence; release NO-GO.** The [feasibility assessment](ACTENON-INTEGRATION-FEASIBILITY.md) is followed by an actual integration experiment. This does not pass its entire preregistered experiment or the North Star acceptance matrix. No production RightClick code, dependency or thirteen-tool interface changes were needed.

## What ran

An ordinary OpenAPI fixture describes an append operation. RightClick X uses its existing reflector and `RuntimeOptions.fetch` extension. A generic HTTP bridge sends materialized request bytes over bounded container stdin/stdout. The host owns the explicit operator request allowlist, Permit grants/signing key, Kernel executor, replay/effect stores and disposable HTTP provider. No cryptography or effect ledger is copied into RightClick X. The Python fixture imports the audited native Actenon implementations.

Three fresh Node processes run in separate Linux containers: discovery without write authority; execution with a trusted operator grant; retained execution after revocation. Persisted capability data crosses processes; no grant, private key, execution proof or credential does. This is process replacement, **not a model-swap experiment**.

The runtime deliberately has no local execution restriction. The independent boundary still refuses unapproved actions. Each consequential proof binds the materialized method, full target, body and headers. The fixture operator permits exactly two body byte strings at one target. The resource-specific effect descriptor ignores negotiation headers for duplicate identity while including them in the proof. This semantic descriptor and the append oracle are fixture-owned code, not general business-effect inference.

The protected principal is the complete unprivileged container, including spawned shell and native code. Inspected settings include no networking, read-only root and input mount, all capabilities dropped, no-new-privileges, bounded memory/processes/CPU, no host PID/IPC, and no Docker socket. Only the client bundle is mounted. A read-only positive control reaches the same host fixture through ordinary Docker networking; the contained HTTP, shell and native-socket probes cannot. The trusted host can still access the loopback provider directly. Host users, Docker daemon compromise, kernel exploits and arbitrary host agents are outside this boundary.

The default Kernel credential broker produces references only. This experiment uses no provider credential and does **not** establish operator-controlled production credential brokering. The launcher is an experiment harness, not a hardened multi-tenant proxy or production Airlock launcher. Airlock supplies its existing Docker availability checks; its original skipped container test remains skipped.

## Evidence and failures

- [Attempt 1](actenon/integration-attempt-1/failure.log): failed at discovery. The adapter incorrectly attached a consequential-effect gate to a read-only proof without a reservation; Kernel correctly refused `MALFORMED_REQUEST`. The corrected adapter separates ordinary read proofs from effect-reserving writes. Raw failure, source snapshot and hashes are retained.
- [Attempt 2](actenon/integration-attempt-2/result.json): 24/24 development checks. No reconciliation or network-reachability positive control yet.
- [Attempt 3](actenon/integration-attempt-3/result.json): 27/27, adding forged signature, unavailable revocation source and trusted reconciliation.
- [Attempt 4](actenon/integration-attempt-4/result.json): 29/29, adding the reachable-target control and native-socket refusal. These successive development runs are not independent samples or fresh holdouts.

The observer is a separate process, importing neither RightClick nor the boundary runner. It reads the provider-owned append journal and public signature artifacts. It observed exactly `approved` and `lost`, once each; no refused attempt added an entry. Fourteen receipts and twelve refusals verified using the public key; all 26 deliberately altered artifacts failed verification. This is an independent observation path, not independent authorship or security certification.

Both HTTP acknowledgement and lost response initially produce `AMBIGUOUS` finality. RightClick's acknowledged run remains unverified. Permit blocks duplicate dispatch and retains ownership; only the trusted host's separate observer result reconciles the two effects to `COMMITTED`. Agent RPC attempts to grant authority or reconcile effects are refused. Signed transport attestations are not treated as business truth.

Exact-target/body/method/header/audience mutation, expired proof (controlled boundary clock), forged signature, unavailable revocation state, replay through a recreated edge, preissued-proof revocation, changed parameters, generated `/api/run`, direct broker misuse, shell and raw network probes are covered. Saved capabilities do not recover revoked authority. The final freeze strengthens reason-code assertions so a generic failure cannot stand in for the expected refusal.

## Preregistered scope still outstanding

The assessment's experiment §7 remains **PARTIAL**. Discovery here uses an explicit read-only grant, rather than literally no grant. It proves discovery cannot grant writes, but does not satisfy that stricter no-grant discovery case. The loopback resource is protected from the contained principal through network isolation plus the sole permitted bridge; it is not an independently deployed resource-owned gate against uncontained host callers. These differences are recorded, not silently accepted as equivalent.

Composition, saved generated goals, alternative MCP/SDK execution, federation, concurrent independent workers, ancestor revocation, separate edge-process restart, and provider change/removal/return remain to be exercised in the integrated configuration. Recreating an edge object with durable state is weaker than killing and restarting its process. Credential-vault isolation, external-resource finality and deployment upgrades remain unestablished. A single exposed OpenAPI fixture is not unfamiliar-software holdout evidence.

The native source stack is pinned and checked; modified or different Actenon revisions refuse. These are audited development commits, not registry releases. The launcher requires Python 3.12, the five audited source installs, Bun, and a local Linux Docker engine with a pre-existing Node >=22.18 image. The tested image provides Node 24.22.0. This is reproducible development setup, **not the exceptionally simple installation target**. `host.docker.internal` assumes Docker Desktop; other platform support is not claimed.

## Economics and next decision

Attempt 4 recorded two successful mediated HTTP responses with median bridge time 7.88 ms (6.23–9.53 ms). Nine refused/uncertain requests had median 0.021 ms, dominated by early refusals. These tiny heterogeneous samples exclude container startup and acquisition/agent costs; they are not a performance benchmark and cannot support a competitive claim.

The integration demonstrates a useful separation of discovery and authority without replacing either ecosystem. It also exposes setup and operator-policy costs. The next commercial test must compare retained scripts and RightClick under the same independent boundary, complete verification and identical access. Do not promote the harness or claim superior economics on this result. Complete missing lifecycle/bypass cases, expose a minimal optional supported transport only after those checks, then freeze fresh holdouts and run the original fair benchmark and model-swap challenge.

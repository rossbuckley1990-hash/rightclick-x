# Actenon discovery without grants and independent worker processes

2026-10-18. **23/23 bounded development checks pass; release remains NO-GO.** Same programme branch and original goal. The [preregistered plan](ACTENON-WORKERS-PLAN.md) and earlier failed integration/lifecycle experiments remain unchanged. No RightClick X core or Actenon source was changed.

## Evidence

Source freeze `0dd86b4` passes [attempt 2](actenon/workers-attempt2/result.json), using the previously audited five Actenon commits and the cached local Node Docker image. [Provenance](actenon/workers-attempt2/provenance.json) binds source snapshots and image identity. The experiment uses ordinary OpenAPI discovery and the existing generic HTTP bridge; no application-specific RightClick reflector was added.

- Public discovery starts with **zero grants**, learns a write capability and leaves the grant store empty. The attempted effect fails without a minted proof or provider change. Only an exact operator-configured public document is readable without authority.
- The operator then installs a grant. A fresh network-isolated Node process executes the retained capability without fetching the discovery document again. This is process reuse, not a fresh AI model result.
- Six separate Python processes initialize their own native Actenon edge objects and SQLite connections, wait at a barrier and submit the same proof. Exactly **one dispatch and one provider effect** occur; five return `DUPLICATE_REPLAY`. A seventh process subsequently returns the same refusal without dispatch.
- A second principal with a separate valid grant cannot mint another reservation for the already-owned semantic effect. This demonstrates shared-store ownership, not authentication across federated hosts.
- A preissued child proof is refused after ancestor revocation. A short-lived grant/proof is refused after actual wall-clock expiry. Claim-time failures at revocation, replay and effect-store interfaces refuse before dispatch. Each fault hook is recorded as reached, and its private error marker is absent from returned artifacts.
- The provider journal contains exactly the two specified effects, `approved` and `race`. A separate observer process verifies **13 signed receipts and 13 signed refusals**, then rejects all **26 altered artifacts**. Receipt counts include refused/ambiguous outcomes, not 13 successful effects. The two dispatched operations retain native `OUTCOME_UNKNOWN` / `AMBIGUOUS` finality; an HTTP acknowledgement does not become verified business completion.

The separate [raw checker](../../../experiments/actenon/check-workers.py) imports neither the experiment nor RightClick X. It checks the fixed expected journal, actual worker artifacts, fault-hook execution, container configuration, retained discovery calls and source hashes. It accepts attempt 2 and rejects the failed attempt 1. This is an independent observation path and separate implementation **by the same author**, not independent-author review or certification.

## Preserved failure and trust implication

[Attempt 1](actenon/workers-attempt1/result.json), frozen at `4717b7b`, passed 18/23 checks. None of the concurrent requests dispatched. The workers had the public Ed25519 proof key and shared databases, but lacked the HMAC grant-verification secret. Permit `claim_effect` calls native `Grant.verify()` before accepting ownership; its failure was correctly refused. The first outage checks did not prove every injected hook was reached, so they are superseded by attempt 2's explicit hook counters, not promoted independently.

The corrected fixture gives the disposable grant secret to trusted authority worker processes through a temporary mode-0600 file. It is never mounted in either agent container, written to evidence or sent over the agent bridge. Native verification remains enabled. This identifies a deployment dependency: using Permit's store-level claim helper directly is **not a public-key-only edge**. A production resource edge needs an appropriately isolated authority service or equivalent reviewed custody design. The fixture also shares a disposable proof/attestation key among trusted processes; separate production signing roles remain required.

## Performance and readiness

The six-process group took **480.69 ms including process startup**. Its per-worker protected calls took 2.61–8.23 ms; the successful dispatch took 4.96 ms including loopback HTTP and artifact generation. These are one local contention group, not throughput/tail estimates or an economic comparison. All baselines still need the same authority controls before making a competitive claim.

This closes the narrowly scoped no-grant discovery and separate-process replay cases. A resource-owned edge with no alternative raw backend route, multi-host/federated identity, production credential brokering, failures during/after dispatch, full crash recovery, independent review and simple released installation remain open. Native expiry bounded the proof lifetime in this test; it does not separately exercise an otherwise unexpired proof against an expired grant. Do not claim universal execution visibility or containment.

The [subscription development pilot](../../adaptive/CLAUDE-DEVELOPMENT.md) is blocked by Claude's weekly quota before any model inference. Strong coding-agent comparison, fresh holdouts, cross-vendor reuse and commercial validation remain unestablished. Preserve the original acceptance thresholds.

## Reproduce

Use the pinned Python environment, Bun and cached Docker image described in [the experiment README](../../../experiments/actenon/README.md), then run from this evidence revision:

```sh
/absolute/audit-root/.venv/bin/python experiments/actenon/workers.py --output /absolute/new-worker-evidence
python3 experiments/actenon/check-workers.py /absolute/new-worker-evidence
/absolute/audit-root/.venv/bin/python experiments/actenon/observe.py /absolute/new-worker-evidence
```

The output directory must be new. The runner cleans up its containers and disposable private state, preserves failed results, and neither downloads images nor invokes a model. [Artifact hashes and check results](actenon/workers-verification.json) bind both attempts.

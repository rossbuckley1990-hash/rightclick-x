# Actenon no-grant discovery and worker experiment

Preregistered before execution on 2026-10-18. This extends the existing bounded fixture; it does not replace its failed runs or acceptance gates. No live models, remote effects, downloads or paid services. Existing audited Actenon revisions and cached Docker image only.

Required observations:

1. Ordinary public OpenAPI discovery succeeds with an empty grant store. An attempted effect fails, no proof is minted, and discovery leaves the store empty and the provider journal unchanged.
2. After an explicit operator grant, a fresh isolated RightClick process can execute the retained capability without rediscovery.
3. Six independent Python edge processes, each with its own native Actenon objects and SQLite connection, contend for one exact proof. All reach a ready barrier before dispatch. Exactly one dispatch/effect and five replay refusals are required. A seventh process started afterward also refuses the proof.
4. A different principal and grant cannot obtain a new reservation for the same already-owned semantic effect. This is shared-store effect ownership, not a claim of federated identity authentication.
5. A preissued child proof is refused after its ancestor is revoked. A preissued proof is refused after real wall-clock grant expiry. Neither causes a provider effect.
6. Fault injection at the revocation, replay-claim and effect-claim interfaces must refuse without dispatch. No unprotected fallback and no private exception text in returned artifacts. This covers claim-time faults, not all storage failure timings.
7. A separate observer process verifies the exact provider journal and native signed artifacts. Altered signatures/artifacts must be rejected. Retain all source snapshots, process outputs and failed attempts.

The fixture still has a host-trusted forwarding edge; a resource-owned edge with no raw backend listener remains open. Host administrators, arbitrary providers, multi-host stores, independent principals' authentication, production credential vaults and whole-lifecycle economics are outside this result. Do not promote those acceptance rows.

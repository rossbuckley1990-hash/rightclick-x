# Resource-owned Actenon boundary experiment

Preregistered 2026-10-18 before implementation/execution. Continues the same North Star programme and audited Actenon stack. This is a disposable local development fixture, not a new software holdout or a production release.

The provider's only business write is a journal append behind a native Actenon gate in its own HTTP service process. There is no forwarding listener or separate raw backend. The service reconstructs method, target, accepted semantic headers and exact body from the received request. Native proof parsing, verification, replay and effect protection remain Actenon's implementations. A private Unix socket connects that trusted service to the authority process for native revocation/claim/settlement; it exposes no grant-issuance operation. The resource receives a public proof-verification key and a separate receipt-signing key, never the issuer or grant-signing key via configuration/environment. Host processes run as the same user and are trusted; this does not isolate them against one another's compromise.

Required observations:

1. Public OpenAPI discovery with zero grants learns capabilities but cannot authorize effects. A new isolated RightClick process reuses them after the operator installs explicit authority.
2. The native resource gate verifies the actual request, not a caller's claimed action. Changed method, URL/path/query/Host, body, semantic headers, signature, audience and unsupported proof profile are refused without effects. The unchanged original proof remains usable once.
3. A network-enabled disposable container can read the exact service's public document, but direct HTTP, shell and raw-socket writes without proofs fail. Unlisted/admin/legacy-like routes and unsupported request framing also cause zero effects. Record server-side requests so a network failure cannot masquerade as an authorization refusal.
4. Retained and generated RightClick routes cannot widen operator bounds. Revocation and private authority-service outage refuse before effects. Resource process restart retains replay protection; there is no fallback to an unprotected execution path.
5. A response lost after durable append cannot produce a duplicate on a fresh-proof retry. Resource-owned durable commit evidence may establish COMMITTED; caller-side HTTP acknowledgement alone must not. A separate process observes the journal and verifies native receipt/refusal signatures and tamper rejection.
6. Exactly the operator-authorized labels occur, once each. The journal and key/store/socket paths are not mounted in the agent containers. Preserve every failed run, raw request, signed artifact, source snapshot and process output.

The private IPC framing is a fixture adapter, not a new authority protocol or released Actenon service. Unknown public request fields fail closed. This experiment does not establish complete visibility over arbitrary software, production credential custody, multi-host federation, independent-author security review, developer economics or a simple released install. Existing acceptance gates are unchanged.

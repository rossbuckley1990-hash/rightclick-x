# Optional Actenon historical evidence

This Node host adapter connects an operator-owned Actenon attestation file to the
existing RightClick X dashboard. It verifies historical resource decisions. It
does **not** install a protected execution boundary, authorize an action, broker
credentials, grant current permission or verify the business outcome.

Provision Actenon separately. The tested source profile is Kernel
`da4b534bbee1850b18ce6ffc5d3dccba0c3a5dcf` and Permit
`5290b1304eead3e638c5a4aa1600fa63ba3137e8`, with Python 3.12, Ed25519 public JWKs
and native `v2alpha1` receipt/refusal attestations. The adapter imports their
existing verifier. Other versions are untested; unknown versions and keys fail
closed. No dependency is downloaded or added to the core runtime.

```ts
import { RightClick, createHandler } from "rightclick-x";
import { actenonAuthorityEvidence } from "rightclick-x/actenon-evidence";

const runtime = await RightClick.create(/* your existing operator configuration */);
const handler = createHandler(runtime, {
  token: process.env.RCX_TOKEN, // existing API authentication
  authorityEvidence: actenonAuthorityEvidence({
    python: "/absolute/operator-owned/venv/bin/python",
    attestations: "/absolute/protected-resource/attestations.jsonl",
    publicKey: "/absolute/operator-owned/resource-public.json",
    origin: "https://resource.example",
    issuer: "resource-edge",
    boundary: "Operator-named resource",
  }),
});
// Serve handler through your existing HTTP host.
```

The public key's exact bytes are pinned when the adapter is constructed. Rotate
the trust anchor by restarting/reconfiguring the trusted host, not by replacing
the file behind a running reader. Keep that key/configuration outside the agent's
writable surface. The resource must sign its decisions independently; accepting
an agent-supplied key would establish nothing.

Authenticated `GET /api/authority-evidence` returns at most 100 projected records
from at most 4 MiB of input. The native subprocess has a 2.5-second timeout and
256 KiB output bound. Raw bodies, target URLs, proofs, credentials and credential
references are excluded. Missing, incomplete, duplicate, unverified or out-of-
boundary records make the feed unavailable. Empty evidence is not proof of no
activity. Standalone signatures do not prove journal completeness, ordering or
that the signed resource's claims are true.

The generic host reader accepts no model/tool setter, retains no evidence in
capability knowledge, and does not alter dispatch. Historical records remain
unlinked to runtime calls unless a separate trustworthy correlation exists.
Current-authority metrics remain unknown. This optional adapter is included in
the local package; it is not an independent security certification or a complete
Actenon production installation.

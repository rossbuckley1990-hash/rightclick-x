"""Independent process: read the provider journal and verify public attestations.

No issuer key, authority store, RightClick runtime, or model claims are used.
This is an independent observation path, not an independent human review.
"""
import json
import sys
from pathlib import Path

from actenon.models import PartyRef
from actenon.receipts import OutcomeAttestationService
from actenon_permit.boundary.proofs import Ed25519PublicKeyVerifier

root = Path(sys.argv[1])
public = json.loads((root / "public.json").read_text())
verifier = Ed25519PublicKeyVerifier([public])
service = OutcomeAttestationService(signer=verifier, issuer=PartyRef(type="service", id="observer"))
counts = {"receipt": 0, "refusal": 0}
for line in (root / "attestations.jsonl").read_text().splitlines():
    record = json.loads(line)
    kind = record["unsigned_payload"]["artifact_type"]
    getattr(service, f"verify_{kind}_attestation")(record, verifier=verifier)
    counts[kind] += 1
    # A signature must reject alteration, not just accept our positive examples.
    record["unsigned_payload"]["outcome_artifact"]["summary"] = "tampered by observer"
    try:
        getattr(service, f"verify_{kind}_attestation")(record, verifier=verifier)
    except Exception:
        pass
    else:
        raise AssertionError("altered signed outcome accepted")
effects = [json.loads(line) for line in (root / "provider.jsonl").read_text().splitlines()]
print(json.dumps({"effects": effects, "verified_attestations": counts,
                  "tampered_attestations_refused": sum(counts.values())}))

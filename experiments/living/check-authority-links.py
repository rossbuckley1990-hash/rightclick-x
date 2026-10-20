"""Separate evidence reconciliation; no runtime, transport or adapter imports.

Same author. Native signatures establish action identity; operator transport
logs establish the local runtime association, not cryptographic runtime identity.
"""
import hashlib
import json
from pathlib import Path
import sys

from actenon.models import PartyRef
from actenon.receipts import OutcomeAttestationService
from actenon_permit.boundary.proofs import Ed25519PublicKeyVerifier


def check(root, feed_name="adaptation-authority.json", snapshot_name="adaptation-final.json"):
    read = lambda name: json.loads((root / name).read_text())
    lines = lambda name: [json.loads(s) for s in (root / name).read_text().splitlines()]
    feed = read(feed_name)
    snapshot = read(snapshot_name)
    assert feed["status"] == "available" and feed["currentAuthority"] == "unknown"
    assert feed["runtimeLinkage"] == "operator-correlated"
    assert feed["source"]["trustAnchor"] == hashlib.sha256((root / "boundary/public.json").read_bytes()).hexdigest()
    verifier = Ed25519PublicKeyVerifier([read("boundary/public.json")])
    service = OutcomeAttestationService(signer=verifier, issuer=PartyRef(type="service", id="checker"))
    native = {}
    for row in lines("boundary/attestations.jsonl"):
        p = row["unsigned_payload"]
        result = getattr(service, "verify_" + p["artifact_type"] + "_attestation")(row, verifier=verifier)
        digest = p["artifact_digest"]["value"]
        assert digest not in native
        native[digest] = result if isinstance(result, dict) else result.to_dict()
    fetches = [r for r in lines("session.jsonl") if r["op"] == "fetch"]
    observations = snapshot["activity"]["entries"]
    logs = lines("boundary/transport-links.jsonl")
    expected = {}
    seen = set()
    for log in logs:
        c = log["context"]
        assert (c["runtimeId"], c["requestId"]) not in seen
        seen.add((c["runtimeId"], c["requestId"]))
        matches = [r for r in fetches if r.get("context") == c]
        assert len(matches) == 1 and matches[0]["request"] == log["wire"]
        runs = [r for r in observations if r["kind"] == "execution.finished" and c["runId"] in r.get("runs", [])]
        assert len(runs) == 1 and runs[0]["epoch"] == c["runtimeId"] and c["capabilityId"] in runs[0]["subjects"]
        for ref in log["artifacts"]:
            digest = ref["artifactDigest"]
            assert digest in native and digest not in expected
            a = native[digest]; wire = log["wire"]
            assert a["correlation"]["request_id"] == ref["nativeRequestId"]
            assert a["target"]["resource_id"] == wire["url"]
            assert a["action"]["parameters"] == {k: wire[k] for k in ("method", "headers", "body")}
            assert a["action"]["capability"] == "http." + wire["method"].lower()
            expected[digest] = {**c, "kind": "operator-correlated"}
    assert expected and len(feed["records"]) == len(native)
    for row in feed["records"]:
        digest = row["artifactDigest"]
        assert digest in native and row.get("runtimeLink") == expected.get(digest)
        # In this challenge every successful protected request originated in the
        # runtime, while direct no-proof probes remain correctly unassociated.
        if row["outcome"] == "executed":
            assert digest in expected
        else:
            assert row["outcome"] == "refused" and digest not in expected
    serialized = json.dumps(snapshot["state"])
    assert all(c["requestId"] not in serialized for c in (log["context"] for log in logs))
    return {"status": "PASS", "linkedArtifacts": len(expected), "unlinkedArtifacts": len(native) - len(expected),
        "transportRequests": len(seen), "owningRuns": len({log["context"]["runId"] for log in logs}),
        "scope": "native signed action plus operator-log correlation; not signed runtime identity or present authority"}


if __name__ == "__main__":
    print(json.dumps(check(Path(sys.argv[1]).resolve()), indent=2))

"""Read-only evidence checker using native public-key verification APIs.

No imports from RightClick or the experiment. Same author, separate process and
implementation; this is not independent-author validation or certification.
"""
import base64
from collections import Counter
import copy
import hashlib
import json
from pathlib import Path
import sys

from actenon.models import PCCB, PartyRef
from actenon.proof.canonical import canonicalize_bytes
from actenon.receipts import OutcomeAttestationService
from actenon_permit.boundary.proofs import Ed25519PublicKeyVerifier

root = Path(sys.argv[1])
read = lambda name: json.loads((root / name).read_text())
lines = lambda name: [json.loads(line) for line in (root / name).read_text().splitlines()]
edges = lines("edge.jsonl")
issuer_public = read("issuer-public.json")
proof_verifier = Ed25519PublicKeyVerifier([issuer_public])
unsupported = [r for r in edges if (r.get("proof") or {}).get("extensions", {}).get("effect", {}).get("profile") == "unsupported-profile"]
assert len(unsupported) == 1
invalid_profile = PCCB.from_dict(unsupported[0]["proof"])
assert proof_verifier.verify(canonicalize_bytes(invalid_profile.unsigned_payload()), invalid_profile.signature), "unsupported-profile control has invalid signature; it cannot establish profile handling"
assert unsupported[0]["outcome"]["reason_code"] == "MALFORMED_REQUEST"
foreign = [r for r in edges if r["outcome"]["reason_code"] == "AUDIENCE_MISMATCH"]
assert len(foreign) == 1
foreign_proof = PCCB.from_dict(foreign[0]["proof"])
assert proof_verifier.verify(canonicalize_bytes(foreign_proof.unsigned_payload()), foreign_proof.signature)
assert foreign_proof.audience.id == "other-boundary"

journal_raw = (root / "provider.jsonl").read_bytes().splitlines(keepends=True)
journal = [json.loads(line) for line in journal_raw]
assert [r["label"] for r in journal] == ["approved", "lost", "proof-control"], "unexpected/missing provider effect"
assert all(r["path"] == "/entries" for r in journal)
assert len({r["proof"] for r in journal}) == 3
successful = {r["proof"]["pccb_id"]: r for r in edges if r["outcome"]["ok"]}
assert set(successful) == {r["proof"] for r in journal}
commitments = read("committed-effects.json")
assert len(commitments) == 3
for i, row in enumerate(journal):
    edge = successful[row["proof"]]
    proof = PCCB.from_dict(edge["proof"])
    assert proof_verifier.verify(canonicalize_bytes(proof.unsigned_payload()), proof.signature)
    params = edge["intent"]["action"]["parameters"]
    assert params["method"] == "POST" and json.loads(base64.b64decode(params["body"])) == {"label": row["label"]}
    receipt = edge["outcome"]["receipt"]
    evidence = receipt["extensions"]["effect"]
    prefix_hash = hashlib.sha256(b"".join(journal_raw[:i + 1])).hexdigest()
    assert evidence["outcome"] == "COMMITTED" and evidence["execution_occurred"] is True and evidence["evidence_hash"] == prefix_hash
    state = next(r for r in commitments if r["reference"]["effect_id"] == evidence["effect_id"])
    assert state["state"] == "COMMITTED" and state["evidence"]["evidence_hash"] == prefix_hash
    assert state["evidence"]["observer"] == "resource-owned-durable-journal"
    assert state["reference"] == proof.extensions["effect"] and state["action_hash"] == proof.action_hash.value

reasons = Counter(r["outcome"]["reason_code"] for r in edges)
assert reasons == {None: 3, "PCCB_REQUIRED": 9, "SCOPE_CAPABILITY_MISMATCH": 1, "TARGET_MISMATCH": 3,
                   "ACTION_MISMATCH": 2, "SIGNATURE_INVALID": 1, "MALFORMED_REQUEST": 1,
                   "AUDIENCE_MISMATCH": 1, "DUPLICATE_REPLAY": 1, "AUTHORITY_REVOKED": 2}
# Match actual received request data to each native edge decision, including
# repeated requests. Public document requests are the only extras.
request_key = lambda wire: json.dumps(wire, sort_keys=True)
received = Counter(request_key(r["wire"]) for r in lines("resource-requests.jsonl"))
for row in edges:
    params = row["intent"]["action"]["parameters"]
    wire = {**params, "url": row["intent"]["target"]["resource_id"]}
    key = request_key(wire)
    assert received[key] > 0, "edge decision not backed by received request"
    received[key] -= 1
assert sum(received.values()) == 2 and all(json.loads(key)["url"].endswith("/openapi.json") for key, count in received.items() if count)

probe = read("direct-probes.json")
p = probe["results"]
assert p["publicDocument"]["status"] == 200
assert set(p["aliases"]) == {"/admin", "/proxy/entries", "/entries/", "/entries?bypass=true", "/legacy/entries"}
assert p["direct"]["status"] == 403 and json.loads(p["direct"]["body"])["reason"] == "PCCB_REQUIRED"
assert all(r["status"] == 403 and json.loads(r["body"])["reason"] == "PCCB_REQUIRED" for r in p["aliases"].values())
assert p["shell"]["exit"] == 0 and json.loads(p["shell"]["stdout"])["status"] == 403
assert p["rawSocket"].startswith("HTTP/1.0 403") and p["duplicateHeader"].startswith("HTTP/1.0 400") and p["transferEncoding"].startswith("HTTP/1.0 400")
assert not p["secrets"] and not p["dockerSocket"] and not p["authorityStore"]
for phase, network in [("issuer/container-discover.json", "none"), ("issuer/container-execute.json", "none"), ("network-probe-container.json", "bridge")]:
    container = read(phase)
    assert container["host"]["NetworkMode"] == network and container["host"]["ReadonlyRootfs"]
    assert container["user"] == "10000:10000" and len(container["mounts"]) == 1 and not container["mounts"][0]["RW"]
    assert container["mounts"][0]["Source"].endswith("/stage")
first, restart = read("resource-first.ready.json"), read("resource-restart.ready.json")
assert first["pid"] != restart["pid"] and first["origin"] == restart["origin"]
assert first["receivedSigningEnvironment"] == restart["receivedSigningEnvironment"] == []
observed = read("resource-listeners.json")
assert observed["pid"] == first["pid"] and observed["exit"] == 0
assert [line[1:] for line in observed["stdout"].splitlines() if line.startswith("n")] == [first["origin"].removeprefix("http://")]
discovery = lines("issuer/public-discovery.jsonl")
assert discovery and all(r["grantCount"] == 0 for r in discovery)
events = lines("issuer/client-execute.jsonl")
assert not any(r.get("request", {}).get("url", "").endswith("/openapi.json") for r in events)
run = next(r["results"] for r in events if r.get("op") == "report")
state = next(r["state"] for r in events if r.get("op") == "report")
serialized = json.dumps(state)
authority_ids = {r["proof"]["extensions"]["authority"]["grant_id"] for r in edges if r.get("proof")}
proof_ids = {r["proof"]["pccb_id"] for r in edges if r.get("proof")}
assert not any(token in serialized for token in authority_ids | proof_ids)
assert "x-actenon-proof" not in serialized.lower() and "x-actenon-intent" not in serialized.lower()
assert run["run"]["status"] == "completed" and run["run"]["verification"]["status"] != "verified"
assert run["lostResponse"]["status"] == run["lostRetry"]["status"] == "failed"
assert run["duplicate"]["status"] == run["changedBody"]["status"] == "failed" and '"failed"' in run["generatedAPI"]

receipt_public = read("public.json")
assert receipt_public != issuer_public
verifier = Ed25519PublicKeyVerifier([receipt_public])
attester = OutcomeAttestationService(signer=verifier, issuer=PartyRef(type="service", id="observer"))
expected_artifacts = Counter(json.dumps(r["outcome"][kind], sort_keys=True) for r in edges for kind in ["receipt", "refusal"] if r["outcome"].get(kind))
counts = Counter()
for record in lines("attestations.jsonl"):
    kind = record["unsigned_payload"]["artifact_type"]
    verify = getattr(attester, f"verify_{kind}_attestation")
    verify(record, verifier=verifier)
    key = json.dumps(record["unsigned_payload"]["outcome_artifact"], sort_keys=True)
    assert expected_artifacts[key] > 0
    expected_artifacts[key] -= 1
    counts[kind] += 1
    changed = copy.deepcopy(record)
    changed["unsigned_payload"]["outcome_artifact"]["summary"] = "tampered"
    try:
        verify(changed, verifier=verifier)
    except Exception:
        pass
    else:
        raise AssertionError("modified signed artifact accepted")
assert not any(expected_artifacts.values()) and counts == {"receipt": 24, "refusal": 21}
provenance = read("provenance.json")
for name, sha in provenance["sources"].items():
    assert hashlib.sha256((root / "sources" / name).read_bytes()).hexdigest() == sha
print(json.dumps({"rawEvidenceChecked": True, "effects": 3, "journalPrefixCommitHashesChecked": 3,
                  "retainedStateContainsNoObservedAuthorityIDsOrProofHeaders": True,
                  "validSignedUnsupportedProfileRefused": True, "validSignedWrongAudienceRefused": True,
                  "verifiedArtifacts": dict(counts), "tamperedArtifactsRefused": sum(counts.values()),
                  "sourceSnapshotsChecked": len(provenance["sources"]), "scope": "separate process/implementation by same author, not independent-author certification"}))

"""Read-only changed-operation evidence check using native Actenon verification.

Same author, separate Python implementation/process; not independent-author review.
Signatures are checked historically. This does not renew expired/revoked authority.
"""
import base64
from collections import Counter
import copy
import hashlib
import json
from pathlib import Path
import shutil
import sys
import tempfile

from actenon.models import ActionIntent, PCCB, PartyRef
from actenon.proof.canonical import canonicalize_bytes, sha256_hex
from actenon.proof.service import build_action_hash_input
from actenon.receipts import OutcomeAttestationService
from actenon_permit.boundary.proofs import Ed25519PublicKeyVerifier


def check(root):
    read = lambda name: json.loads((root / name).read_text())
    rows = lambda name: [json.loads(line) for line in (root / name).read_text().splitlines()]
    key = lambda value: json.dumps(value, sort_keys=True)
    reports = {phase: next(r for r in rows(f"client-{phase}.jsonl") if r.get("op") == "report")
               for phase in read("phase-results.json")}
    assert {phase: r["results"] for phase, r in reports.items()} == read("phase-results.json")
    initial, moved, approved = [reports[p] for p in ["initial", "moved", "approved-move"]]
    mr, ar = moved["results"], approved["results"]
    assert mr["run"]["status"] == "failed" and "required anchor contract changed meaning" in mr["run"]["error"]
    assert initial["state"]["published"][0]["anchors"] == moved["state"]["published"][0]["anchors"]
    replacement = mr["explicitChangedTarget"]
    assert replacement["status"] == "failed" and "independent authority refused" in replacement["error"]
    change = next(c for c in moved["state"]["meaningChanges"] if c.get("current") == replacement["capability"])
    assert change["id"] != change["current"]
    replanned = mr["replanChangedTarget"]["executed"]
    assert replanned["status"] == "failed" and any("independent authority refused" in a["error"] for a in replanned["attempts"])
    outgoing = [r["request"] for r in rows("client-moved.jsonl") if r.get("op") == "fetch" and r["request"]["method"] == "POST"]
    assert len(outgoing) == 2 and all(r["url"].endswith("/entries-v2") for r in outgoing)
    bridge = rows("bridge.jsonl")
    refused = Counter(key(r["request"]) for r in bridge if not r["reply"]["ok"])
    assert not (Counter(map(key, outgoing)) - refused), "fresh requests lack independent broker refusals"
    assert not any(r["method"] == "POST" and r["mode"] == "moved" for r in rows("provider-requests.jsonl"))
    assert ar["compose"]["published"]["trust"] == "verified"
    assert ar["retainedChangedId"]["status"] == "failed" and "changed meaning" in ar["retainedChangedId"]["error"]
    assert ar["retainedChangedId"]["capability"] == change["id"]
    for phase in ["incompatible", "removed", "ack-only"]:
        run = reports[phase]["results"]["run"]
        assert run["status"] == "failed" and run["verification"]["status"] != "verified"
    returned = reports["returned"]["results"]["run"]
    assert returned["status"] == "completed" and returned["verification"]["status"] == "verified"
    effects = rows("provider.jsonl")
    assert [r["label"] for r in effects] == ["initial", "warm", "peer", "compatible", "moved", "returned"]
    assert [r["path"] for r in effects] == ["/entries"] * 4 + ["/entries-v2"] * 2

    verifier = Ed25519PublicKeyVerifier([read("public.json")])
    service = OutcomeAttestationService(signer=verifier, issuer=PartyRef(type="service", id="checker"))
    edges = rows("edge.jsonl")
    transported = Counter(key(r["request"]) for r in bridge)
    grants = rows("operator-transitions.jsonl")
    old, new = grants[0]["grant"]["id"], grants[1]["grant"]["id"]
    assert old != new and grants[1]["revoked_grant"] == old
    for edge in edges:
        proof, intent = PCCB.from_dict(edge["proof"]), ActionIntent.from_dict(edge["intent"])
        assert verifier.verify(canonicalize_bytes(proof.unsigned_payload()), proof.signature)
        assert proof.action_hash.value == sha256_hex(build_action_hash_input(intent))
        assert edge["proof"]["action"] == edge["intent"]["action"] and edge["proof"]["target"] == edge["intent"]["target"]
        wire = {**edge["intent"]["action"]["parameters"], "url": edge["intent"]["target"]["resource_id"]}
        assert transported[key(wire)] > 0, "proof has no recorded request"
        transported[key(wire)] -= 1
        if wire["method"] == "POST":
            assert json.loads(base64.b64decode(wire["body"]))["label"] in ["initial", "warm", "peer", "compatible", "moved", "returned", "missing"]
            expected = new if wire["url"].endswith("/entries-v2") else old
            assert proof.extensions["authority"]["grant_id"] == expected
    expected = Counter(key(e["outcome"][kind]) for e in edges for kind in ["receipt", "refusal"] if e["outcome"].get(kind))
    artifacts = rows("attestations.jsonl")
    for record in artifacts:
        kind = record["unsigned_payload"]["artifact_type"]
        verify = getattr(service, f"verify_{kind}_attestation")
        verify(record, verifier=verifier)
        payload = key(record["unsigned_payload"]["outcome_artifact"])
        assert expected[payload] > 0, "signed artifact not linked to observed edge outcome"
        expected[payload] -= 1
        altered = copy.deepcopy(record)
        altered["unsigned_payload"]["outcome_artifact"]["summary"] = "altered"
        try:
            verify(altered, verifier=verifier)
        except Exception:
            pass
        else:
            raise AssertionError("tampered artifact accepted")
    assert not any(expected.values())
    authority_ids = {e["proof"]["pccb_id"] for e in edges} | {old, new}
    for report in reports.values():
        state = key(report["state"])
        assert not any(token in state for token in authority_ids)
        assert "x-actenon-proof" not in state.lower()
    return {"effects": len(effects), "exactRequestProofsVerified": len(edges), "signedArtifactsLinkedAndVerified": len(artifacts),
            "alteredArtifactsRefused": len(artifacts), "freshDeniedRequests": len(outgoing), "oldAnchorsUnchanged": True}


if __name__ == "__main__":
    root = Path(sys.argv[1]).resolve()
    checked = check(root)
    controls = {}
    for name in ["changed-proof-target", "hidden-denied-request", "reused-operator-grant", "false-verified-outcome"]:
        with tempfile.TemporaryDirectory(prefix="rcx-lifecycle-control-") as temp:
            copied = Path(temp) / "evidence"
            shutil.copytree(root, copied)
            if name == "changed-proof-target":
                path = copied / "edge.jsonl"
                rows = [json.loads(l) for l in path.read_text().splitlines()]
                rows[0]["proof"]["target"]["resource_id"] += "?changed=true"
                path.write_text("\n".join(json.dumps(r) for r in rows) + "\n")
            elif name == "hidden-denied-request":
                path = copied / "client-moved.jsonl"
                rows = [json.loads(l) for l in path.read_text().splitlines()]
                rows.pop(next(i for i, r in enumerate(rows) if r.get("op") == "fetch" and r["request"]["method"] == "POST"))
                path.write_text("\n".join(json.dumps(r) for r in rows) + "\n")
            elif name == "reused-operator-grant":
                path = copied / "operator-transitions.jsonl"
                rows = [json.loads(l) for l in path.read_text().splitlines()]
                rows[1]["grant"]["id"] = rows[0]["grant"]["id"]
                path.write_text("\n".join(json.dumps(r) for r in rows) + "\n")
            else:
                path = copied / "client-ack-only.jsonl"
                rows = [json.loads(l) for l in path.read_text().splitlines()]
                report = next(r for r in rows if r.get("op") == "report")
                report["results"]["run"]["verification"]["status"] = "verified"
                path.write_text("\n".join(json.dumps(r) for r in rows) + "\n")
                phases = json.loads((copied / "phase-results.json").read_text())
                phases["ack-only"] = report["results"]
                (copied / "phase-results.json").write_text(json.dumps(phases))
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            try:
                check(copied)
            except (AssertionError, ValueError, KeyError, StopIteration) as error:
                controls[name] = {"rejected": True, "mutatedSha256": digest, "error": type(error).__name__}
            else:
                raise AssertionError(f"corruption accepted: {name}")
    print(json.dumps({"verdict": "PASS", "checked": checked, "controls": controls,
                      "scope": "historical fixture verification by same author; not independent-author validation or general containment"}, indent=2))

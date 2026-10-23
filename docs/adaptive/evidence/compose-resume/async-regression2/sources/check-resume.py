"""Separate historical evidence check; same author, native public-key APIs only."""
import base64
from collections import Counter
import gzip
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
    lines = lambda name: [json.loads(s) for s in (root / name).read_text().splitlines()]
    key = lambda v: json.dumps(v, sort_keys=True)
    reports = {phase: read(phase + ".json") for phase in ["discover", "pause", "resume-denied", "resume-authorised"]}
    for phase, report in reports.items():
        assert report == next(r for r in lines(f"issuer/client-{phase}.jsonl") if r.get("op") == "report")
        container = read(f"issuer/container-{phase}.json")
        assert container["host"]["NetworkMode"] == "none" and container["host"]["ReadonlyRootfs"]
        assert container["user"] == "10000:10000" and len(container["mounts"]) == 1 and not container["mounts"][0]["RW"]
    assert all(r["grantCount"] == 0 for r in lines("issuer/public-discovery.jsonl"))
    transitions = lines("operator-transitions.jsonl")
    assert [r["phase"] for r in transitions] == ["initial", "revoke", "new-grant"]
    old, new = transitions[0]["grant"]["id"], transitions[2]["grant"]["id"]
    assert old != new and transitions[1]["grant"] == old
    paused, denied, done = [reports[p]["results"]["run"] for p in ["pause", "resume-denied", "resume-authorised"]]
    assert paused["status"] == denied["status"] == "pending"
    assert paused["pending"]["resumeId"] == "resume:" + paused["runId"]
    assert denied["httpContinuation"]["stopped"] == "denied" and denied["verification"]["status"] == "unverified"
    assert done["status"] == "completed" and done["verification"]["status"] == "checked" and done["resumes"] == paused["runId"]
    assert done["verification"]["results"] and all(r["ok"] for r in done["verification"]["results"])
    checkpoint = reports["pause"]["state"]["httpContinuations"][0]
    assert checkpoint["runId"] == paused["runId"] and checkpoint["cursor"]["used"] == 1
    assert reports["resume-denied"]["state"]["httpContinuations"][0]["cursor"]["used"] == 2
    assert reports["resume-authorised"]["state"]["httpContinuations"] == []
    assert reports["resume-authorised"]["state"]["receipts"][-1]["resumes"] == paused["runId"]
    document = "Authorised document for first. " * 100
    artifact = (root / "artifacts/first.gz").read_bytes()
    assert gzip.decompress(artifact).decode() == document
    assert done["output"]["sha256"] == hashlib.sha256(artifact).hexdigest()
    journal = lines("provider.jsonl")
    assert len(journal) == 1 and journal[0]["label"] == "first" and journal[0]["document"] == document

    edges = lines("edge.jsonl")
    issuer = Ed25519PublicKeyVerifier([read("issuer-public.json")])
    received = Counter(key(r["wire"]) for r in lines("resource-requests.jsonl"))
    for edge in edges:
        assert edge["outcome"]["ok"], "all denied resume requests should stop at the issuer in this experiment"
        proof, intent = PCCB.from_dict(edge["proof"]), ActionIntent.from_dict(edge["intent"])
        assert issuer.verify(canonicalize_bytes(proof.unsigned_payload()), proof.signature)
        assert proof.action_hash.value == sha256_hex(build_action_hash_input(intent))
        assert edge["proof"]["target"] == edge["intent"]["target"] and edge["proof"]["action"] == edge["intent"]["action"]
        wire = {**edge["intent"]["action"]["parameters"], "url": edge["intent"]["target"]["resource_id"]}
        assert received[key(wire)] > 0
        received[key(wire)] -= 1
    assert sum(received.values()) == 2
    assert all(json.loads(k)["url"].endswith(("/catalog", "/openapi.json")) for k, n in received.items() if n)
    writes = [e for e in edges if e["intent"]["action"]["parameters"]["method"] == "POST"]
    assert len(writes) == 1 and writes[0]["proof"]["pccb_id"] == journal[0]["proof"]
    assert writes[0]["proof"]["extensions"]["authority"]["grant_id"] == old
    assert json.loads(base64.b64decode(writes[0]["intent"]["action"]["parameters"]["body"])) == {"label": "first", "document": document}
    for phase in ["resume-denied", "resume-authorised"]:
        calls = [r["request"] for r in lines(f"issuer/client-{phase}.jsonl") if r.get("op") == "fetch"]
        assert calls and all(r["method"] == "GET" and not r["url"].endswith(("/catalog", "/openapi.json")) for r in calls)
        if phase == "resume-authorised":
            for wire in calls:
                edge = next(e for e in edges if {**e["intent"]["action"]["parameters"], "url": e["intent"]["target"]["resource_id"]} == wire
                    and e["proof"]["extensions"]["authority"]["grant_id"] == new)
                assert edge["outcome"]["ok"]
        else:
            bridge = lines("issuer/bridge.jsonl")
            assert all(any(r["request"] == wire and not r["reply"].get("response") and not r["reply"]["ok"] for r in bridge) for wire in calls)
    verifier = Ed25519PublicKeyVerifier([read("public.json")])
    service = OutcomeAttestationService(signer=verifier, issuer=PartyRef(type="service", id="checker"))
    expected = Counter(key(e["outcome"]["receipt"]) for e in edges)
    artifacts = lines("attestations.jsonl")
    for artifact in artifacts:
        assert artifact["unsigned_payload"]["artifact_type"] == "receipt"
        service.verify_receipt_attestation(artifact, verifier=verifier)
        record = key(artifact["unsigned_payload"]["outcome_artifact"])
        assert expected[record] > 0
        expected[record] -= 1
    assert not any(expected.values())
    for report in reports.values():
        saved = key(report["state"])
        assert old not in saved and new not in saved and document not in saved
        assert not any(e["proof"]["pccb_id"] in saved for e in edges)
    for name, digest in read("provenance.json")["sources"].items():
        assert hashlib.sha256((root / "sources" / name).read_bytes()).hexdigest() == digest
    return {"effects": 1, "exactSuccessfulProofs": len(edges), "signedArtifacts": len(artifacts),
            "businessArtifactVerified": True, "revokedResumeRefusedBeforeDispatch": True, "resumedWithNewGrant": True}


if __name__ == "__main__":
    root = Path(sys.argv[1]).resolve()
    checked = check(root)
    rejected = []
    for case in ["extra-write", "artifact", "proof", "renewed-checkpoint"]:
        with tempfile.TemporaryDirectory(prefix="rcx-resume-check-") as tmp:
            target = Path(tmp) / "evidence"; shutil.copytree(root, target)
            if case == "extra-write":
                p = target / "provider.jsonl"; p.write_bytes(p.read_bytes() * 2)
            elif case == "artifact":
                (target / "artifacts/first.gz").write_bytes(gzip.compress(b"wrong"))
            elif case == "proof":
                p = target / "edge.jsonl"; rows = [json.loads(s) for s in p.read_text().splitlines()]
                rows[0]["proof"]["target"]["resource_id"] += "/other"
                p.write_text("".join(json.dumps(r) + "\n" for r in rows))
            else:
                p = target / "resume-denied.json"; data = json.loads(p.read_text())
                data["state"]["httpContinuations"][0]["cursor"]["used"] = 0
                p.write_text(json.dumps(data))
            try: check(target)
            except Exception: rejected.append(case)
            else: raise AssertionError(f"accepted corrupted {case}")
    print(json.dumps({"checked": checked, "corruptionsRejected": rejected,
        "scope": "same author, separate native verification implementation; not independent-author review"}, indent=2))

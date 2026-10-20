"""Offline separate implementation checking a development session's artifacts.

Uses native Actenon verifiers; imports no runtime, session driver or issuer.
Same author, controlled resource; not an independent-author security review.
"""
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
    key = lambda value: json.dumps(value, sort_keys=True)
    initial, final = read("baseline.json"), read("final.json")
    info = read("container.json")
    assert info["host"]["NetworkMode"] == "none" and info["host"]["ReadonlyRootfs"]
    assert info["user"] == "10000:10000" and not info["host"]["Privileged"]
    assert info["host"]["CapDrop"] == ["ALL"] and "no-new-privileges" in info["host"]["SecurityOpt"]
    assert len(info["mounts"]) == 1 and not info["mounts"][0]["RW"]
    assert len(initial["state"]["published"]) == 0 and len(final["state"]["published"]) == 2
    assert final["state"]["workflowContinuations"] == final["state"]["httpContinuations"] == []
    assert all(row["grantCount"] == 0 for row in lines("boundary/issuer/public-discovery.jsonl"))
    for name in ["unauthorized", "changed-parameters"]:
        run = read(name + ".json")
        assert run["status"] == "failed" and run["refusal"] and run["verification"]["status"] == "unverified"
        assert not run.get("healing") and not run.get("attempts")
    bridge = lines("boundary/issuer/bridge.jsonl")
    if (root / "revoked-run.json").exists():
        revoked = read("revoked-run.json")
        assert revoked["status"] == "failed" and revoked["refusal"] and revoked["verification"]["status"] == "unverified"
        assert not bridge[-1]["reply"]["ok"] and not bridge[-1]["reply"].get("response")
        assert bridge[-1]["request"] == bridge[2]["request"], "the identical action must also require current authority"
        bridge = bridge[:-1]
        assert read("effects-after-revoke.json") == read("effects.json")
    assert 5 <= len(bridge) <= 7 and not bridge[0]["reply"]["ok"] and not bridge[1]["reply"]["ok"]
    assert all(row["reply"].get("response") for row in bridge[2:])
    statuses = [row["reply"]["response"]["status"] for row in bridge[2:]]
    # At most four follow-up GETs, exactly the existing runtime profile. Pending
    # monitor reads may repeat; the original POST must never repeat.
    assert statuses == [202] * (len(statuses) - 2) + [303, 200]
    assert [row["request"]["method"] for row in bridge] == ["POST"] * 3 + ["GET"] * (len(bridge) - 3)
    origin = read("boundary-ready.json")["origin"]
    assert all(row["request"]["url"] == origin + "/jobs/first" for row in bridge[3:-1])
    assert bridge[-1]["request"]["url"] == origin + "/artifacts/first"
    assert len(lines("boundary/provider.jsonl")) == 1
    job = lines("boundary/provider.jsonl")[0]
    task = read("protected-task.json")
    assert {k: job[k] for k in task} == task
    artifact = root / "boundary/artifacts/first.gz"
    assert gzip.decompress(artifact.read_bytes()).decode() == task["document"]
    digest = hashlib.sha256(artifact.read_bytes()).hexdigest()
    assert read("protected-composition.json")["executed"]["output"] == digest
    assert read("effects.json") == {"effects": [job], "artifacts": {"first.gz": digest}}
    assert not list((root / "boundary/publications").iterdir())
    issuer = Ed25519PublicKeyVerifier([read("boundary/issuer-public.json")])
    edges = lines("boundary/edge.jsonl")
    accepted = [row for row in edges if row["outcome"]["ok"]]
    direct_refusal = (root / "direct-refusal.json").exists()
    assert len(accepted) == len(bridge) - 2 and len(edges) == len(accepted) + int(direct_refusal)
    if direct_refusal:
        assert read("direct-refusal.json")["status"] == 403
        refused = [row for row in edges if not row["outcome"]["ok"]]
        assert len(refused) == 1 and refused[0]["proof"] is None
        assert refused[0]["intent"]["action"]["parameters"]["method"] == "POST"
    received = Counter(key(row["wire"]) for row in lines("boundary/resource-requests.jsonl") if row["hasProof"])
    assert len({row["proof"]["pccb_id"] for row in accepted}) == len(accepted)
    for row in accepted:
        proof, intent = PCCB.from_dict(row["proof"]), ActionIntent.from_dict(row["intent"])
        assert issuer.verify(canonicalize_bytes(proof.unsigned_payload()), proof.signature)
        assert proof.action_hash.value == sha256_hex(build_action_hash_input(intent))
        assert row["proof"]["target"] == row["intent"]["target"] and row["proof"]["action"] == row["intent"]["action"]
        wire = {**row["intent"]["action"]["parameters"], "url": row["intent"]["target"]["resource_id"]}
        assert received[key(wire)] >= 1
        received[key(wire)] -= 1
    assert not any(received.values()), "every protected request must have one distinct accepted proof"
    writes = [row for row in accepted if row["intent"]["action"]["parameters"]["method"] == "POST"]
    assert len(writes) == 1 and writes[0]["proof"]["pccb_id"] == job["proof"]
    assert json.loads(base64.b64decode(writes[0]["intent"]["action"]["parameters"]["body"])) == task
    assert writes[0]["outcome"]["receipt"]["extensions"]["effect"]["outcome"] == "COMMITTED"
    operator = lines("boundary/operator.jsonl")
    assert len(operator) == 1 + int((root / "revoked-run.json").exists())
    assert operator[0]["op"] == "authorize" and len(operator[0]["requests"]) == 1
    if len(operator) == 2:
        assert operator[1]["op"] == "revoke"
    grant = operator[0]["grant"]["id"]
    assert all(row["proof"]["extensions"]["authority"]["grant_id"] == grant for row in accepted)
    assert grant not in key(final["state"])
    assert all(row["proof"]["pccb_id"] not in key(final["state"]) for row in accepted)
    verifier = Ed25519PublicKeyVerifier([read("boundary/public.json")])
    service = OutcomeAttestationService(signer=verifier, issuer=PartyRef(type="service", id="checker"))
    expected = Counter((kind, key(row["outcome"][kind])) for row in edges
        for kind in ["receipt", "refusal"] if row["outcome"].get(kind))
    artifacts = lines("boundary/attestations.jsonl")
    for artifact in artifacts:
        kind = artifact["unsigned_payload"]["artifact_type"]
        assert kind in {"receipt", "refusal"}
        getattr(service, f"verify_{kind}_attestation")(artifact, verifier=verifier)
        record = (kind, key(artifact["unsigned_payload"]["outcome_artifact"]))
        assert expected[record] > 0
        expected[record] -= 1
    assert not any(expected.values())
    if direct_refusal:
        feed = read("authority-evidence.json")
        assert feed["status"] == "available" and feed["currentAuthority"] == "unknown"
        assert feed["runtimeLinkage"] == "not-established"
        assert feed["source"]["trustAnchor"] == hashlib.sha256((root / "boundary/public.json").read_bytes()).hexdigest()
        assert {row["artifactDigest"] for row in feed["records"]} == {a["unsigned_payload"]["artifact_digest"]["value"] for a in artifacts}
        assert Counter(row["outcome"] for row in feed["records"]) == {"executed": len(accepted), "refused": 2}
        assert Counter(row["artifactType"] for row in feed["records"]) == {"receipt": len(accepted) + 1, "refusal": 1}
        assert "body" not in key(feed) and "credential" not in key(feed) and "secret_reference" not in key(feed)
        if (root / "revoked-evidence.json").exists():
            historical = read("revoked-evidence.json")
            assert historical["status"] == "available" and historical["currentAuthority"] == "unknown"
            assert historical["records"] == feed["records"], "revocation does not rewrite historical decisions"
    calls = lines("session.jsonl")
    assert len([row for row in calls if row.get("op") == "fetch"]) == read("summary.json")["totalRequests"]
    observed = [row["row"] for row in calls if row.get("op") == "tool-observation"]
    assert observed == read("tool-calls.json")
    return {"retainedGoals": 2, "exactSuccessfulProofs": len(accepted), "signedResourceArtifacts": len(artifacts),
        "issuerRefusals": 2 + int((root / "revoked-run.json").exists()), "jobs": 1, "unexpectedEffects": 0, "publicRequests": len(read("public-network.json")),
        "mediatedRequests": read("summary.json")["totalRequests"], "toolCalls": len(observed),
        "initialOperations": len(initial["graph"]["capabilities"]), "finalOperations": len(final["graph"]["capabilities"]),
        "initialRSS": initial["rss"], "finalRSS": final["rss"]}


if __name__ == "__main__":
    root = Path(sys.argv[1]).resolve()
    checked = check(root)
    rejected = []
    cases = ["artifact", "extra-effect", "proof", "attestation", "retained-grant", "read-budget", "replayed-submit", "unaccounted-request"]
    if (root / "authority-evidence.json").exists():
        cases.append("false-refusal-label")
    for case in cases:
        with tempfile.TemporaryDirectory(prefix="rcx-session-check-") as temporary:
            copy = Path(temporary) / "evidence"
            shutil.copytree(root, copy)
            if case == "artifact":
                (copy / "boundary/artifacts/first.gz").write_bytes(gzip.compress(b"wrong document"))
            elif case == "extra-effect":
                file = copy / "boundary/provider.jsonl"
                file.write_bytes(file.read_bytes() * 2)
            elif case in {"proof", "attestation"}:
                file = copy / ("boundary/edge.jsonl" if case == "proof" else "boundary/attestations.jsonl")
                rows = [json.loads(s) for s in file.read_text().splitlines()]
                if case == "proof":
                    next(row for row in rows if row["proof"])["proof"]["target"]["resource_id"] += "/changed"
                else:
                    rows[0]["unsigned_payload"]["outcome_artifact"]["capability"] = "changed"
                file.write_text("".join(json.dumps(row) + "\n" for row in rows))
            elif case == "retained-grant":
                file = copy / "final.json"
                value = json.loads(file.read_text())
                grant = json.loads((copy / "boundary/operator.jsonl").read_text().splitlines()[0])["grant"]["id"]
                value["state"]["unexpectedAuthority"] = grant
                file.write_text(json.dumps(value))
            elif case in {"read-budget", "replayed-submit"}:
                file = copy / "boundary/issuer/bridge.jsonl"
                rows = [json.loads(s) for s in file.read_text().splitlines()]
                if case == "read-budget":
                    rows = rows[:3] + [rows[3]] * 5 + rows[3:]
                else:
                    rows[3]["request"]["method"] = "POST"
                file.write_text("".join(json.dumps(row) + "\n" for row in rows))
            elif case == "unaccounted-request":
                file = copy / "boundary/resource-requests.jsonl"
                rows = [json.loads(s) for s in file.read_text().splitlines()]
                rows.append(next(row for row in rows if row["hasProof"]))
                file.write_text("".join(json.dumps(row) + "\n" for row in rows))
            else:
                file = copy / "authority-evidence.json"
                value = json.loads(file.read_text())
                next(row for row in value["records"] if row["outcome"] == "refused")["outcome"] = "executed"
                file.write_text(json.dumps(value))
            try:
                check(copy)
            except Exception:
                rejected.append(case)
            else:
                raise AssertionError("accepted corrupted " + case)
    print(json.dumps({"status": "PASS", "checked": checked, "corruptionsRejected": rejected,
        "scope": "same-author separate offline checker; native proofs and local artifact, not universal containment or independent authorship"}, indent=2))

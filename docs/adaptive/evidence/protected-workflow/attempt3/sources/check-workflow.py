"""Separate native artifact/result verification; same author, no harness import."""
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
    names = ["discover", "first-pause", "workflow-resume-changed", "workflow-resume-revoked",
             "workflow-resume-authorised", "publication-denied-pause", "workflow-resume-publication-denied",
             "revoked-between-pause", "workflow-resume-revoked-between"]
    reports = {name: read(name + ".json") for name in names}
    for name, report in reports.items():
        assert report == next(r for r in lines(f"issuer/client-{name}.jsonl") if r.get("op") == "report")
        info = read(f"issuer/container-{name}.json")
        assert info["host"]["NetworkMode"] == "none" and info["host"]["ReadonlyRootfs"]
        assert info["user"] == "10000:10000" and len(info["mounts"]) == 1 and not info["mounts"][0]["RW"]
    assert all(r["grantCount"] == 0 for r in lines("issuer/public-discovery.jsonl"))
    initial = reports["first-pause"]["results"]["run"]
    done = reports["workflow-resume-authorised"]["results"]["run"]
    assert initial["status"] == "pending" and initial["pending"]["resumeId"] == "resume:" + initial["runId"]
    assert done["status"] == "completed" and done["verification"]["status"] == "checked" and done["resumes"] == initial["runId"]
    assert done["verification"]["results"] and all(r["ok"] for r in done["verification"]["results"])
    assert reports["workflow-resume-authorised"]["state"]["workflowContinuations"] == []
    assert reports["workflow-resume-authorised"]["state"]["httpContinuations"] == []
    assert reports["workflow-resume-changed"]["results"]["run"]["status"] == "pending"
    assert not any(r.get("op") == "fetch" for r in lines("issuer/client-workflow-resume-changed.jsonl"))
    assert reports["workflow-resume-revoked"]["results"]["run"]["status"] == "pending"
    for name in ["workflow-resume-publication-denied", "workflow-resume-revoked-between"]:
        run = reports[name]["results"]["run"]
        assert run["status"] == "failed" and run["verification"]["status"] == "unverified" and run["refusal"]
        assert not run.get("healing") and not run.get("attempts")
    for name in names:
        if not name.startswith("workflow-resume"):
            continue
        calls = [r["request"] for r in lines(f"issuer/client-{name}.jsonl") if r.get("op") == "fetch"]
        assert all(not w["url"].endswith(("/catalog", "/openapi.json")) and
                   not (w["method"] == "POST" and w["url"].endswith("/jobs")) for w in calls)
    transitions = lines("issuer/operator-transitions.jsonl")
    assert [t["phase"] for t in transitions] == ["initial", "revoke-pending", "renew-for-remaining-action",
        "publication-denied", "revoked-between", "revoke-between-steps", "native-proof-controls"]
    grants = {t["phase"]: t["grant"]["id"] for t in transitions if isinstance(t["grant"], dict)}
    assert len(set(grants.values())) == len(grants)
    assert transitions[1]["grant"] == grants["initial"] and transitions[5]["grant"] == grants["revoked-between"]
    assert transitions[0]["publications"] is False and transitions[2]["publications"] is True and transitions[3]["publications"] is False

    journal = lines("provider.jsonl")
    jobs = [r for r in journal if r.get("kind") != "publication"]
    publications = [r for r in journal if r.get("kind") == "publication"]
    assert sorted(r["label"] for r in jobs) == ["first", "generated", "second"]
    assert sorted(r["label"] for r in publications) == ["first", "generated"]
    assert not (root / "publications/second.json").exists()
    for row in jobs:
        document = f"Authorised document for {row['label']}. " * 100
        assert row["document"] == document
        assert gzip.decompress((root / "artifacts" / f"{row['label']}.gz").read_bytes()).decode() == document
    for row in publications:
        assert row == read(f"publications/{row['label']}.json")
        assert row["sha256"] == hashlib.sha256((root / "artifacts" / f"{row['label']}.gz").read_bytes()).hexdigest()
    assert done["output"] == read("publications/first.json")["sha256"]
    assert len(read("committed-effects.json")) == 5 and all(c["state"] == "COMMITTED" for c in read("committed-effects.json"))

    issuer = Ed25519PublicKeyVerifier([read("issuer-public.json")])
    edges = lines("edge.jsonl")
    received = Counter(key(r["wire"]) for r in lines("resource-requests.jsonl"))
    accepted = [e for e in edges if e["outcome"]["ok"]]
    for e in accepted:
        proof, intent = PCCB.from_dict(e["proof"]), ActionIntent.from_dict(e["intent"])
        assert issuer.verify(canonicalize_bytes(proof.unsigned_payload()), proof.signature)
        assert proof.action_hash.value == sha256_hex(build_action_hash_input(intent))
        assert e["proof"]["target"] == e["intent"]["target"] and e["proof"]["action"] == e["intent"]["action"]
        wire = {**e["intent"]["action"]["parameters"], "url": e["intent"]["target"]["resource_id"]}
        assert received[key(wire)] > 0
        received[key(wire)] -= 1
    writes = [e for e in accepted if e["intent"]["action"]["parameters"]["method"] == "POST"]
    assert len(writes) == 5
    for row in journal:
        e = next(e for e in writes if e["proof"]["pccb_id"] == row["proof"])
        wire = e["intent"]
        body = json.loads(base64.b64decode(wire["action"]["parameters"]["body"]))
        assert e["outcome"]["receipt"]["extensions"]["effect"]["outcome"] == "COMMITTED"
        if row.get("kind") == "publication":
            assert wire["target"]["resource_id"].endswith("/publications/" + row["label"])
            assert body == {"sha256": row["sha256"]}
            expected_grant = "renew-for-remaining-action" if row["label"] == "first" else "native-proof-controls"
        else:
            assert wire["target"]["resource_id"].endswith("/jobs")
            assert body == {"label": row["label"], "document": row["document"]}
            expected_grant = {"first": "initial", "generated": "publication-denied", "second": "revoked-between"}[row["label"]]
        assert e["proof"]["extensions"]["authority"]["grant_id"] == grants[expected_grant]
    bridge = lines("issuer/bridge.jsonl")
    for name in ["workflow-resume-revoked", "workflow-resume-publication-denied", "workflow-resume-revoked-between"]:
        calls = [r["request"] for r in lines(f"issuer/client-{name}.jsonl") if r.get("op") == "fetch"]
        last = calls[-1]
        assert any(r["request"] == last and not r["reply"].get("response") and not r["reply"]["ok"] for r in bridge)
    for report in reports.values():
        saved = key(report["state"])
        assert all(grant not in saved for grant in grants.values())
        assert all(e["proof"]["pccb_id"] not in saved for e in accepted)

    verifier = Ed25519PublicKeyVerifier([read("public.json")])
    service = OutcomeAttestationService(signer=verifier, issuer=PartyRef(type="service", id="checker"))
    expected = Counter((kind, key(e["outcome"][kind])) for e in edges for kind in ["receipt", "refusal"] if e["outcome"].get(kind))
    artifacts = lines("attestations.jsonl")
    for artifact in artifacts:
        kind = artifact["unsigned_payload"]["artifact_type"]
        assert kind in {"receipt", "refusal"}
        getattr(service, f"verify_{kind}_attestation")(artifact, verifier=verifier)
        record = (kind, key(artifact["unsigned_payload"]["outcome_artifact"]))
        assert expected[record] > 0
        expected[record] -= 1
    assert not any(expected.values())
    controls = read("mutation-results.json")
    for name, reason in {"method": "SCOPE_CAPABILITY_MISMATCH", "target": "TARGET_MISMATCH", "query": "TARGET_MISMATCH",
                         "body": "ACTION_MISMATCH", "headers": "ACTION_MISMATCH", "forged": "SIGNATURE_INVALID", "replay": "DUPLICATE_REPLAY"}.items():
        assert controls[name]["reason"] == reason and not controls[name]["ok"]
    assert controls["original"]["response"]["status"] == 200
    probes = read("direct-probes.json")["results"]
    assert probes["publicDocument"]["status"] == 200 and probes["direct"]["status"] == probes["changedMethod"]["status"] == 403
    assert all(p["status"] == 403 for p in [*probes["aliases"].values(), *probes["reads"].values()])
    assert probes["shell"]["exit"] == 0 and json.loads(probes["shell"]["stdout"])["status"] == 403
    assert probes["rawSocket"].startswith("HTTP/1.0 403") and not probes["secrets"] and not probes["dockerSocket"] and not probes["authorityStore"]
    probe = read("network-probe-container.json")
    assert probe["host"]["NetworkMode"] == "bridge" and probe["host"]["ReadonlyRootfs"] and probe["user"] == "10000:10000"
    assert len(probe["mounts"]) == 1 and not probe["mounts"][0]["RW"]
    for name, digest in read("provenance.json")["sources"].items():
        assert hashlib.sha256((root / "sources" / name).read_bytes()).hexdigest() == digest
    return {"workflowSuccesses": 1, "refusedRemainingEffects": 2, "jobs": 3, "publications": 2,
        "separateNativeControlPublications": 1, "exactSuccessfulProofs": len(accepted), "signedArtifacts": len(artifacts)}


if __name__ == "__main__":
    root = Path(sys.argv[1]).resolve()
    checked = check(root)
    rejected = []
    for case in ["publication", "artifact", "extra-effect", "proof", "attestation"]:
        with tempfile.TemporaryDirectory(prefix="rcx-workflow-check-") as tmp:
            target = Path(tmp) / "evidence"; shutil.copytree(root, target)
            if case == "publication":
                p = target / "publications/first.json"; value = json.loads(p.read_text()); value["sha256"] = "0" * 64; p.write_text(json.dumps(value))
            elif case == "artifact":
                (target / "artifacts/first.gz").write_bytes(gzip.compress(b"wrong document"))
            elif case == "extra-effect":
                p = target / "provider.jsonl"; p.write_bytes(p.read_bytes() * 2)
            elif case == "proof":
                p = target / "edge.jsonl"; rows = [json.loads(s) for s in p.read_text().splitlines()]
                next(e for e in rows if e["outcome"]["ok"])["proof"]["target"]["resource_id"] += "/wrong"
                p.write_text("".join(json.dumps(r) + "\n" for r in rows))
            else:
                p = target / "attestations.jsonl"; rows = [json.loads(s) for s in p.read_text().splitlines()]
                rows[0]["unsigned_payload"]["outcome_artifact"]["capability"] = "changed"
                p.write_text("".join(json.dumps(r) + "\n" for r in rows))
            try: check(target)
            except Exception: rejected.append(case)
            else: raise AssertionError(f"accepted corrupted {case}")
    print(json.dumps({"checked": checked, "corruptionsRejected": rejected,
        "scope": "same author, separate native verification implementation; controlled resource only"}, indent=2))

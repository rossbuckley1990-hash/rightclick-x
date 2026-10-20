"""Separate offline checker for the combined session and its controlled releases.

Imports native Actenon verification, never the runtime or provider implementation.
Same author, exposed development evidence, not independent-author certification.
"""
import base64
from collections import Counter
import gzip
import hashlib
import importlib.util
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

spec = importlib.util.spec_from_file_location("base_session_check", Path(__file__).with_name("check-session.py"))
base_checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base_checker)


def base_copy(root, destination):
    shutil.copytree(root, destination)
    cutoff = json.loads((root / "adaptation-base-cutoff.json").read_text())
    for name, count in cutoff["lines"].items():
        path = (destination / name).resolve()
        assert path.is_relative_to(destination.resolve()) and isinstance(count, int) and count >= 0
        rows = path.read_text().splitlines()
        assert len(rows) >= count
        path.write_text("".join(row + "\n" for row in rows[:count]))
    for source, target in [("adaptation-base-tools.json", "tool-calls.json"), ("adaptation-base-public.json", "public-network.json")]:
        shutil.copyfile(root / source, destination / target)
    return base_checker.check(destination)


def check(root):
    read = lambda name: json.loads((root / name).read_text())
    lines = lambda name: [json.loads(row) for row in (root / name).read_text().splitlines()]
    key = lambda value: json.dumps(value, sort_keys=True)
    with tempfile.TemporaryDirectory(prefix="rcx-base-prefix-") as temporary:
        original = base_copy(root, Path(temporary) / "session")
    phases = {row["name"]: row for row in read("adaptation-phases.json")}
    assert len(phases) == 24
    for name in ["incompatible-run", "incompatible-generated", "removed-run"]:
        assert phases[name]["requests"] == 0
    for name in ["compatible-denied", "incompatible-fresh", "returned-denied"]:
        run = read("adaptation-" + name + ".json")
        assert run["status"] == "failed" and run["refusal"] and phases[name]["requests"] == 1
        assert run["verification"]["status"] != "verified"
    for name, message in [("incompatible-run", "changed meaning"), ("removed-run", "unresolved required anchor")]:
        run = read("adaptation-" + name + ".json")
        assert run["status"] == "failed" and message in run["error"] and run.get("output") is None
    generated = read("adaptation-incompatible-generated.json")
    assert generated["status"] == 400 and "changed meaning" in generated["body"]["error"]
    assert "result" not in generated["body"]

    initial, final = read("final.json")["state"], read("adaptation-final.json")["state"]
    assert len(initial["published"]) == len(final["published"]) == 2
    after = {row["slug"]: row for row in final["published"]}
    for goal in initial["published"]:
        # Usage counters and the selected implementation may change; the caller's
        # original contract, anchors and verification obligations must not.
        for field in ["slug", "have", "want", "intent", "verify", "require", "witnesses", "origins", "risks", "through", "anchors", "publishedAt"]:
            assert goal.get(field) == after[goal["slug"]].get(field), ("retained obligation", field)
    assert final["httpContinuations"] == []
    assert len(final["workflowContinuations"]) == 3
    for index, checkpoint in enumerate(final["workflowContinuations"]):
        assert checkpoint["phase"] == "stopped"
        resumed = read("adaptation-stopped-resume-" + str(index) + ".json")
        assert resumed["status"] == "pending" and not resumed["pending"].get("resumeId")
        assert phases["stopped-resume-" + str(index)]["requests"] == 0
    tasks = read("adaptation-tasks.json")
    expected = {"first": read("protected-task.json"), "second": tasks["second"], "generated": tasks["returned"]}
    jobs = lines("boundary/provider.jsonl")
    assert [row["label"] for row in jobs] == list(expected)
    assert not list((root / "boundary/publications").iterdir())
    assert {p.name for p in (root / "boundary/artifacts").iterdir()} == {label + ".gz" for label in expected}
    digests = {}
    for job in jobs:
        task = expected[job["label"]]
        assert {k: job[k] for k in task} == task
        data = (root / "boundary/artifacts" / (job["label"] + ".gz")).read_bytes()
        assert gzip.decompress(data).decode() == task["document"]
        digests[job["label"] + ".gz"] = hashlib.sha256(data).hexdigest()
    for name, label in [("compatible", "second"), ("returned", "generated")]:
        run = read("adaptation-" + name + "-run.json")
        assert run["status"] == "completed" and run["output"] == digests[label + ".gz"]
        assert 3 <= phases[name + "-run"]["requests"] <= 5
    two = read("adaptation-compatible-effects.json")
    assert len(two["effects"]) == 2
    assert read("adaptation-incompatible-effects.json") == read("adaptation-removed-effects.json") == two
    assert read("adaptation-returned-effects.json") == {"effects": jobs, "artifacts": digests}

    issuer = Ed25519PublicKeyVerifier([read("boundary/issuer-public.json")])
    edges = lines("boundary/edge.jsonl")
    accepted = [row for row in edges if row["outcome"]["ok"]]
    assert len(edges) == len(accepted) + 1
    assert len({row["proof"]["pccb_id"] for row in accepted}) == len(accepted)
    received = Counter(key(row["wire"]) for row in lines("boundary/resource-requests.jsonl") if row["hasProof"])
    grants = {row["grant"]["id"]: row["requests"] for row in lines("boundary/operator.jsonl") if row["op"] == "authorize"}
    assert len(grants) == 3
    origin = read("boundary-ready.json")["origin"]
    writes = []
    for row in accepted:
        proof, intent = PCCB.from_dict(row["proof"]), ActionIntent.from_dict(row["intent"])
        assert issuer.verify(canonicalize_bytes(proof.unsigned_payload()), proof.signature)
        assert proof.action_hash.value == sha256_hex(build_action_hash_input(intent))
        wire = {**row["intent"]["action"]["parameters"], "url": row["intent"]["target"]["resource_id"]}
        assert received[key(wire)] >= 1
        received[key(wire)] -= 1
        grant = row["proof"]["extensions"]["authority"]["grant_id"]
        assert grant in grants and grant not in key(final) and proof.pccb_id not in key(final)
        if wire["method"] == "POST":
            assert wire in grants[grant] and wire["url"] == origin + "/jobs"
            task = json.loads(base64.b64decode(wire["body"]))
            assert task == expected[task["label"]]
            assert next(j for j in jobs if j["label"] == task["label"])["proof"] == proof.pccb_id
            assert row["outcome"]["receipt"]["extensions"]["effect"]["outcome"] == "COMMITTED"
            writes.append(task["label"])
        else:
            assert wire["method"] == "GET" and wire["body"] == ""
            assert wire["url"] in {origin + prefix + label for label in expected for prefix in ["/jobs/", "/artifacts/"]}
    assert writes == list(expected) and not any(received.values())
    bridge = lines("boundary/issuer/bridge.jsonl")
    assert sum(not row["reply"].get("response") for row in bridge) == 6
    assert sum(bool(row["reply"].get("response")) for row in bridge) == len(accepted)
    for label in expected:
        route = [row for row in bridge if row["reply"].get("response") and (
            row["request"]["url"] in {origin + "/jobs/" + label, origin + "/artifacts/" + label} or
            row["request"]["method"] == "POST" and json.loads(base64.b64decode(row["request"]["body"]))["label"] == label)]
        statuses = [row["reply"]["response"]["status"] for row in route]
        assert 3 <= len(route) <= 5
        assert statuses == [202] * (len(route) - 2) + [303, 200]
        terminal = json.loads(base64.b64decode(route[-1]["reply"]["response"]["body"]))
        actual = terminal if label == "first" else terminal["artifact"]
        assert actual["sha256"] == digests[label + ".gz"]
    verifier = Ed25519PublicKeyVerifier([read("boundary/public.json")])
    service = OutcomeAttestationService(signer=verifier, issuer=PartyRef(type="service", id="checker"))
    pending = Counter((kind, key(row["outcome"][kind])) for row in edges for kind in ["receipt", "refusal"] if row["outcome"].get(kind))
    artifacts = lines("boundary/attestations.jsonl")
    for artifact in artifacts:
        payload = artifact["unsigned_payload"]; kind = payload["artifact_type"]
        getattr(service, f"verify_{kind}_attestation")(artifact, verifier=verifier)
        entry = (kind, key(payload["outcome_artifact"]))
        assert pending[entry] > 0
        pending[entry] -= 1
    assert not any(pending.values())
    feed = read("adaptation-authority.json")
    assert feed["status"] == "available" and feed["currentAuthority"] == "unknown" and feed["runtimeLinkage"] == "not-established"
    assert {r["artifactDigest"] for r in feed["records"]} == {a["unsigned_payload"]["artifact_digest"]["value"] for a in artifacts}
    assert Counter(r["outcome"] for r in feed["records"]) == {"executed": len(accepted), "refused": 2}
    for phase in ["compatible-before", "compatible-after", "incompatible-before", "incompatible-after", "removed-before", "removed-after", "returned-after"]:
        view = read("adaptation-view-" + phase + ".json")
        expected_validity = "descriptor-matches-observation" if phase in ["compatible-after", "returned-after"] else "dependencies-changed"
        assert view["goal"]["states"]["validity"]["state"] == expected_validity, ("validity", phase)
        assert view["goal"]["states"]["authority"]["state"] == "unknown"
    activity = read("adaptation-final.json")["activity"]["entries"]
    assert {"provider.drifted", "provider.forgotten", "environment.source"} <= {e["kind"] for e in activity}
    assert any(e["kind"] == "environment.source" and e["status"] == "removed" for e in activity)
    total = read("adaptation-summary.json")
    calls = lines("session.jsonl")
    assert sum(row.get("op") == "fetch" for row in calls) == total["totalRequests"]
    assert [row["row"] for row in calls if row.get("op") == "tool-observation"] == read("tool-calls.json")
    assert len(read("tool-calls.json")) == total["toolCalls"]
    return {"base": original, "jobs": 3, "unexpectedEffects": 0, "exactProofs": len(accepted),
        "signedArtifacts": len(artifacts), "issuerRefusals": 6, "requests": total["totalRequests"],
        "toolCalls": total["toolCalls"], "goalContractPreserved": True, "lifecycleViews": 7,
        "stoppedWorkflowsPreservedWithoutReplay": 3}


if __name__ == "__main__":
    root = Path(sys.argv[1]).resolve()
    result = check(root)
    corruptions = []
    for case in ["artifact", "extra-effect", "proof", "dispatch-after-removal", "weakened-goal", "false-validity", "operator-header"]:
        with tempfile.TemporaryDirectory(prefix="rcx-adaptation-check-") as temporary:
            copy = Path(temporary) / "session"; shutil.copytree(root, copy)
            if case == "artifact":
                (copy / "boundary/artifacts/second.gz").write_bytes(gzip.compress(b"wrong document"))
            elif case == "extra-effect":
                path = copy / "boundary/provider.jsonl"; path.write_bytes(path.read_bytes() * 2)
            elif case == "proof":
                path = copy / "boundary/edge.jsonl"
                rows = [json.loads(s) for s in path.read_text().splitlines()]
                next(r for r in rows if r["proof"])["proof"]["target"]["resource_id"] += "/changed"
                path.write_text("".join(json.dumps(r) + "\n" for r in rows))
            elif case == "dispatch-after-removal":
                path = copy / "adaptation-phases.json"; value = json.loads(path.read_text())
                next(r for r in value if r["name"] == "removed-run")["requests"] = 1
                path.write_text(json.dumps(value))
            elif case == "weakened-goal":
                path = copy / "adaptation-final.json"; value = json.loads(path.read_text())
                value["state"]["published"][1]["anchors"] = []
                path.write_text(json.dumps(value))
            elif case == "false-validity":
                path = copy / "adaptation-view-removed-after.json"; value = json.loads(path.read_text())
                value["goal"]["states"]["validity"]["state"] = "descriptor-matches-observation"
                path.write_text(json.dumps(value))
            else:
                path = copy / "boundary/operator.jsonl"
                rows = [json.loads(s) for s in path.read_text().splitlines()]
                next(r for r in rows if r["op"] == "authorize")["requests"][0]["headers"]["accept"] = "text/plain"
                path.write_text("".join(json.dumps(r) + "\n" for r in rows))
            try:
                check(copy)
            except Exception:
                corruptions.append(case)
            else:
                raise AssertionError("accepted corrupted " + case)
    print(json.dumps({"status": "PASS", "checked": result, "corruptionsRejected": corruptions,
        "scope": "same-author separate offline implementation, native signature verification and actual artifact checks; not independent-author holdout or universal containment"}, indent=2))

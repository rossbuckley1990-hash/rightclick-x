"""Same-author native association corruption controls, no fabricated live trial."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import tempfile
from urllib.parse import urlsplit

root = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("adapter", root / "integrations/actenon/authority-evidence.py")
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)
source = root / "docs/adaptive/evidence/session-models/attempt2/boundary"
rows = [json.loads(s) for s in (source / "attestations.jsonl").read_text().splitlines()]
context = {"runtimeId": "11111111-1111-4111-8111-111111111111", "requestId": "22222222-2222-4222-8222-222222222222",
           "runId": "run_control", "capabilityId": "openapi:development:control"}
payload = rows[0]["unsigned_payload"]
artifact = payload["outcome_artifact"]
wire = {**artifact["action"]["parameters"], "url": artifact["target"]["resource_id"]}
link = {"version": 1, "context": context, "wire": wire, "artifacts": [{
    "artifactDigest": payload["artifact_digest"]["value"], "nativeRequestId": artifact["correlation"]["request_id"]}]}
results = []
with tempfile.TemporaryDirectory(prefix="rcx-native-links-") as temp:
    directory = Path(temp)
    evidence = directory / "attestations.jsonl"
    journal = directory / "links.jsonl"
    args = SimpleNamespace(public_key=source / "public.json",
        trust_anchor=hashlib.sha256((source / "public.json").read_bytes()).hexdigest(),
        issuer="resource-edge", origin=json.loads((source / "resource-living.ready.json").read_text())["origin"],
        attestations=evidence, transport_links=journal)
    for case in ["valid", "legacy", "wrong-method", "wrong-body", "wrong-header", "wrong-target", "wrong-gate-request",
                 "wrong-reference", "duplicate-artifact", "duplicate-request", "bad-context", "incomplete", "oversized", "tampered-signature"]:
        logs = [copy.deepcopy(link)]
        selected = copy.deepcopy(rows)
        args.transport_links = None if case == "legacy" else journal
        expected = "linked" if case == "valid" else "unlinked" if case in ("legacy", "wrong-reference") else "rejected"
        if case.startswith("wrong-"):
            if case == "wrong-method": logs[0]["wire"]["method"] = "DELETE"
            if case == "wrong-body": logs[0]["wire"]["body"] = "e30="
            if case == "wrong-header": logs[0]["wire"]["headers"]["accept"] = "changed"
            if case == "wrong-target": logs[0]["wire"]["url"] += "/other"
            if case == "wrong-gate-request": logs[0]["artifacts"][0]["nativeRequestId"] = "other"
            if case == "wrong-reference": logs[0]["artifacts"][0]["artifactDigest"] = "0" * 64
        if case in ("duplicate-artifact", "duplicate-request"):
            logs.append(copy.deepcopy(logs[0]))
            if case == "duplicate-artifact": logs[1]["context"]["requestId"] = "33333333-3333-4333-8333-333333333333"
            else: logs[1]["artifacts"][0]["artifactDigest"] = "0" * 64
        if case == "bad-context": logs[0]["context"]["runtimeId"] = "not-a-runtime"
        if case == "tampered-signature": selected[0]["signature"]["value"] = "A" * len(selected[0]["signature"]["value"])
        evidence.write_text("".join(json.dumps(row) + "\n" for row in selected))
        data = "".join(json.dumps(row) + "\n" for row in logs)
        if case == "incomplete": data = data[:-1]
        if case == "oversized": data = " " * (4 * 1024 * 1024 + 1)
        journal.write_text(data)
        try:
            batch = adapter.project(args)
            actual = "linked" if any("runtimeLink" in r for r in batch["records"]) else "unlinked"
            assert "parameters" not in json.dumps(batch) and "http://" not in json.dumps(batch)
        except (ValueError, TypeError, KeyError):
            actual = "rejected"
        assert actual == expected, (case, actual, expected)
        results.append({"case": case, "result": actual})
    # Real exposed signed replay evidence: the proof and wire are identical,
    # but the original success and replay refusal belong to different attempts.
    replay_source = root / "docs/adaptive/evidence/living-session/protected-regression"
    replay_rows = [json.loads(s) for s in (replay_source / "attestations.jsonl").read_text().splitlines()]
    refused = next(r for r in replay_rows if r["unsigned_payload"]["artifact_type"] == "receipt" and
        "DUPLICATE_REPLAY" in r["unsigned_payload"]["outcome_artifact"].get("reason_codes", []))
    ra = refused["unsigned_payload"]["outcome_artifact"]
    accepted = next(r for r in replay_rows if r["unsigned_payload"]["artifact_type"] == "receipt" and
        r["unsigned_payload"]["outcome_artifact"].get("outcome") == "executed" and
        r["unsigned_payload"]["outcome_artifact"]["correlation"].get("pccb_id") == ra["correlation"]["pccb_id"])
    aa = accepted["unsigned_payload"]["outcome_artifact"]
    assert aa["action"] == ra["action"] and aa["target"] == ra["target"]
    assert aa["correlation"]["action_hash"] == ra["correlation"]["action_hash"]
    assert aa["correlation"]["request_id"] != ra["correlation"]["request_id"]
    args.public_key = replay_source / "public.json"
    args.trust_anchor = hashlib.sha256(args.public_key.read_bytes()).hexdigest()
    target = urlsplit(aa["target"]["resource_id"])
    args.origin = f"{target.scheme}://{target.netloc}"
    args.transport_links = journal
    selected = [accepted, refused]
    evidence.write_text("".join(json.dumps(r) + "\n" for r in selected))
    logs = []
    for n, row in enumerate(selected):
        p = row["unsigned_payload"]; a = p["outcome_artifact"]
        c = {**context, "runId": f"run_replay_{n}", "requestId": f"{n + 1:08d}-1111-4111-8111-111111111111"}
        logs.append({"version": 1, "context": c, "wire": {**a["action"]["parameters"], "url": a["target"]["resource_id"]},
            "artifacts": [{"artifactDigest": p["artifact_digest"]["value"], "nativeRequestId": a["correlation"]["request_id"]}]})
    journal.write_text("".join(json.dumps(r) + "\n" for r in logs))
    projected = adapter.project(args)["records"]
    assert [r["outcome"] for r in projected] == ["executed", "refused"]
    assert [r["runtimeLink"]["runId"] for r in projected] == ["run_replay_0", "run_replay_1"]
    results.append({"case": "same-proof-same-wire-distinct-native-attempts", "result": "linked-separately"})
    journal.write_text(json.dumps({**logs[0], "artifacts": logs[0]["artifacts"] + logs[1]["artifacts"]}) + "\n")
    try:
        adapter.project(args)
    except ValueError:
        results.append({"case": "two-gate-attempts-in-one-response", "result": "rejected"})
    else:
        raise AssertionError("different gate attempts combined into one transport response")
    logs[1]["artifacts"][0]["nativeRequestId"] = logs[0]["artifacts"][0]["nativeRequestId"]
    journal.write_text("".join(json.dumps(r) + "\n" for r in logs))
    try:
        adapter.project(args)
    except ValueError:
        results.append({"case": "replay-refusal-borrowed-original-attempt", "result": "rejected"})
    else:
        raise AssertionError("replay refusal inherited original success association")
print(json.dumps({"status": "PASS", "controls": results}, indent=2))

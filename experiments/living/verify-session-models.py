"""Offline frozen-source and combined-session reconciliation; same author."""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parents[2]
manifest_file = Path(sys.argv[1]).resolve()
manifest = json.loads(manifest_file.read_text())
evidence = manifest_file.parent
read = lambda name: json.loads((evidence / name).read_text())
digest = lambda data: hashlib.sha256(data).hexdigest()
for name, expected in manifest["sources"].items():
    path = (root / name).resolve()
    assert path.is_relative_to(root)
    frozen = subprocess.check_output(["git", "show", manifest["engineeringRevision"] + ":" + name], cwd=root)
    assert digest(path.read_bytes()) == digest(frozen) == expected, ("source", name)
for name, expected in manifest["artifacts"].items():
    path = (root / name).resolve()
    assert path.is_relative_to(root) and digest(path.read_bytes()) == expected, ("artifact", name)

script = root / "experiments/living/check-session-models.py"
spec = importlib.util.spec_from_file_location("combined_checker", script)
checker = importlib.util.module_from_spec(spec); spec.loader.exec_module(checker)
totals = {"reportedTokens": 0, "sessionSeconds": 0, "completedModelTurns": 0}
identities = set()
for trial, oracle in [("attempt1", "oracle-attempt1"), ("attempt2", "oracle-final")]:
    sessions = read(trial + "/models/sessions.json")
    provenance = read(trial + "/models/provenance.json")
    assert [s["task"] for s in sessions] == provenance["tasks"]
    for name, expected in provenance["sources"].items():
        data = subprocess.check_output(["git", "show", provenance["revision"] + ":" + name], cwd=root)
        assert digest(data) == expected, ("historical source", trial, name)
    journal = checker.prior.jsonl(evidence / trial / "session.jsonl")
    requests = [r["request"] for r in journal if r.get("op") == "fetch"]
    rows, truth = [], {}
    for session in sessions:
        task = session["task"]; directory = f'{trial}/models/{task["id"]}'
        preflight = read(directory + "/preflight/preflight.json")
        response = preflight["responses"]
        allowance = response["account/rateLimits/read"]; bucket = allowance["rateLimitsByLimitId"]["codex"]
        assert preflight["passed"] and response["account/read"]["type"] == "chatgpt" and allowance["ordinaryUsageAllowed"]
        assert bucket["credits"] == {"hasCredits": False, "unlimited": False, "balance": "0"}
        assert 0 <= bucket["primary"]["usedPercent"] < 90
        assert any(m["model"] == task["model"] for m in response["model/list"])
        audit = read(directory + "/agent-audit.json")
        assert audit["threadId"] not in identities
        identities.add(audit["threadId"])
        rows.append({"session": session, "audit": audit,
            "events": checker.prior.jsonl(evidence / directory / "agent.stdout")})
        if task["expected"] == "unavailable":
            truth[task["id"]] = read(oracle + "/" + task["id"] + "-structure-status.json")
        else:
            structure = read(oracle + "/" + task["id"] + "-structure.json")
            publication = read(oracle + "/" + task["id"] + "-publication.json")["message"]
            truth[task["id"]] = {"doi": structure["rcsb_primary_citation"]["pdbx_database_id_DOI"],
                "title": publication["title"], "publisher": publication["publisher"]}
    checked = checker.verify(rows, truth, read(trial + "/tool-calls.json"), requests)
    assert checked == read(oracle + "/models-result.json")["checked"]
    totals["reportedTokens"] += checked["reportedTokens"]
    totals["sessionSeconds"] += checked["sessionSeconds"]
    totals["completedModelTurns"] += len(sessions)
assert len(identities) == 6 and "4 !== 3" in read("attempt1/failure.json")["error"]
assert not (evidence / "attempt1/adaptation-final.json").exists()
final = json.loads(subprocess.check_output([sys.executable, "-B", str(script),
    str(evidence / "attempt2"), str(evidence / "oracle-final"), "--offline"], cwd=root))
assert final == read("check-final.json")
base = read("oracle-base/result.json")
assert base["status"] == "PASS" and all(base["checks"].values())
output = read("attempt2/goal-0.json")["executed"]["output"]["message"]
structure = read("oracle-base/structure.json")
publication = read("oracle-base/publication.json")["message"]
assert output["DOI"].lower() == structure["rcsb_primary_citation"]["pdbx_database_id_DOI"].lower()
assert all(output[k] == publication[k] for k in ["DOI", "title", "publisher"])
for name, count in [("focused-regression.log", 17), ("harness-tests-final.log", 1)]:
    log = (evidence / name).read_text()
    assert all(s in log for s in [f"tests {count}", f"pass {count}", "fail 0", "cancelled 0", "skipped 0"])
assert read("checker-tests-final.json")["status"] == "PASS"
assert read("prior-adaptation-check.json") == json.loads((root / "docs/adaptive/evidence/session-adaptation/check-passing.json").read_text())
print(json.dumps({"status": "PASS", "sources": len(manifest["sources"]), "artifacts": len(manifest["artifacts"]),
    **totals, "freshThreads": len(identities), "combinedTrial": "PASS", "preservedFailedTrials": 1,
    "scope": "same-author offline source, trace, public readback and native artifact reconciliation; no new network/model calls, independent authorship or economic superiority"}, indent=2))

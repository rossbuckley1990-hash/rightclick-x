"""Offline reconciliation of frozen source, preserved failures and session evidence."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parents[2]
manifest = json.loads(Path(sys.argv[1]).read_text())
digest = lambda data: hashlib.sha256(data).hexdigest()
for name, expected in manifest["sources"].items():
    file = (root / name).resolve()
    assert file.is_relative_to(root)
    frozen = subprocess.check_output(["git", "show", manifest["engineeringRevision"] + ":" + name], cwd=root)
    assert digest(file.read_bytes()) == digest(frozen) == expected, ("source", name)
for name, expected in manifest["artifacts"].items():
    file = (root / name).resolve()
    assert file.is_relative_to(root)
    assert digest(file.read_bytes()) == expected, ("artifact", name)
evidence = root / "docs/adaptive/evidence/living-session"
read = lambda name: json.loads((evidence / name).read_text())
for name, count in [("regression-final.log", 448), ("linux.log", 82)]:
    log = (evidence / name).read_text()
    assert all(s in log for s in [f"tests {count}", f"pass {count}", "fail 0", "cancelled 0", "skipped 0"])
assert "PASS: 28/28 checks" in (evidence / "proof-2.log").read_text()
assert "fail 2" in (evidence / "workflow-learning-before.log").read_text()
assert "pass 445" in (evidence / "regression.log").read_text()
assert "listen EPERM" in (evidence / "proof-failure.json").read_text()
for path, report, oracle in [("attempt2", "goal-0.json", "public-check"), ("reuse", "run-0.json", "reuse-check")]:
    result = read(oracle + "/result.json")
    assert result["status"] == "PASS" and all(result["checks"].values())
    structure = read(oracle + "/structure.json")
    publication = read(oracle + "/publication.json")["message"]
    candidate = read(path + "/" + report)
    output = candidate["executed"]["output"] if path == "attempt2" else candidate["output"]
    assert output["message"]["DOI"].lower() == structure["rcsb_primary_citation"]["pdbx_database_id_DOI"].lower()
    assert all(output["message"][k] == publication[k] for k in ["title", "publisher"])
reuse = read("reuse/summary.json")
assert reuse["requests"] == 2 and reuse["discoveryRequests"] == 0 and reuse["toolCalls"] == 1
restored = read("reuse/provenance.json")["restored"]
assert restored["sha256"] == digest((evidence / "attempt2/final.json").read_bytes())
assert read("old-reader.json")["bytesPreserved"] and read("old-reader.json")["calls"] == 0
assert not read("old-reader.json")["created"]
for script, directory, result_file in [
    ("experiments/living/check-session.py", "attempt2", "session-check-1.json"),
    ("experiments/actenon/check-workflow.py", "protected-regression", "protected-check.json"),
]:
    result = json.loads(subprocess.check_output([sys.executable, "-B", str(root / script), str(evidence / directory)], cwd=root))
    assert result == read(result_file)
checks = read("protected-regression/result.json")["checks"]
assert len(checks) == 30 and all(checks.values())
print(json.dumps({"status": "PASS", "sources": len(manifest["sources"]), "artifacts": len(manifest["artifacts"]),
    "nativeTests": 448, "linuxTests": 82, "proofChecks": 28, "protectedControls": 30,
    "scope": "same-author offline reconciliation and native proof verification; no new network/model calls or independent-author review"}, indent=2))

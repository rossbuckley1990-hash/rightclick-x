"""Offline source/artifact reconciliation; same author, not certification."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parents[2]
manifest = json.loads(Path(sys.argv[1]).read_text())
digest = lambda data: hashlib.sha256(data).hexdigest()
for name, expected in manifest["sources"].items():
    path = (root / name).resolve()
    assert path.is_relative_to(root)
    frozen = subprocess.check_output(["git", "show", manifest["productRevision"] + ":" + name], cwd=root)
    assert digest(frozen) == expected and digest(path.read_bytes()) == expected, ("source mismatch", name)
for name, expected in manifest["artifacts"].items():
    path = (root / name).resolve()
    assert path.is_relative_to(root)
    assert digest(path.read_bytes()) == expected, ("artifact mismatch", name)
ev = root / "docs/adaptive/evidence/planning-refusal"
for name, count in [("native-freeze.log", 441), ("linux-freeze.log", 136)]:
    log = (ev / name).read_text()
    assert all(s in log for s in [f"tests {count}", f"pass {count}", "fail 0", "cancelled 0", "skipped 0"])
assert "PASS: 28/28 checks" in (ev / "proof.log").read_text()
assert "fail 5" in (ev / "baseline.log").read_text()
assert "ERR_INVALID_TYPESCRIPT_SYNTAX" in (ev / "harness-syntax-failure.log").read_text()
read = lambda name: json.loads((ev / name).read_text())
assert read("tool-interface.json")["tools"] == 13
assert read("metadata.json")["productCommit"] == manifest["productRevision"]
assert len(read("protected-regression/result.json")["checks"]) == 30
assert all(read("protected-regression/result.json")["checks"].values())
comparison = json.loads(subprocess.check_output([sys.executable, "-B", str(root / "experiments/living/check-planning-refusal.py"),
    str(ev / "comparison-baseline-final.json"), str(ev / "comparison-candidate-final.json")], cwd=root))
assert comparison == read("checker.json")
native = json.loads(subprocess.check_output([sys.executable, "-B", str(root / "experiments/actenon/check-workflow.py"),
    str(ev / "protected-regression")], cwd=root))
assert native == read("protected-check.json")
print(json.dumps({"status": "PASS", "sources": len(manifest["sources"]), "artifacts": len(manifest["artifacts"]),
    "nativeTests": 441, "linuxTests": 136, "proofChecks": 28, "protectedControls": 30,
    "comparisonCorruptionsRejected": len(comparison["corruptionsRejected"]),
    "nativeCorruptionsRejected": len(native["corruptionsRejected"]),
    "scope": "same-author offline reconciliation and native artifact verification; no new model/provider run or independent-author review"}, indent=2))

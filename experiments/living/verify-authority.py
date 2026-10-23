"""Offline frozen-source/evidence reconciliation; not independent authorship."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parents[2]
manifest_path = Path(sys.argv[1]).resolve()
manifest = json.loads(manifest_path.read_text())
evidence = manifest_path.parent
digest = lambda value: hashlib.sha256(value).hexdigest()
read = lambda name: json.loads((evidence / name).read_text())

for name, expected in manifest["sources"].items():
    file = (root / name).resolve()
    assert file.is_relative_to(root)
    frozen = subprocess.check_output(["git", "show", manifest["engineeringRevision"] + ":" + name], cwd=root)
    assert digest(file.read_bytes()) == digest(frozen) == expected, ("source", name)
for name, expected in manifest["artifacts"].items():
    file = (root / name).resolve()
    assert file.is_relative_to(root)
    assert digest(file.read_bytes()) == expected, ("artifact", name)
for name, count in [("native-final.log", 452), ("linux-final.log", 56), ("linux-state.log", 7)]:
    log = (evidence / name).read_text()
    assert all(s in log for s in [f"tests {count}", f"pass {count}", "fail 0", "cancelled 0", "skipped 0"])
assert "PASS: 28/28 checks" in (evidence / "proof-final.log").read_text()
assert len(read("protected-regression/result.json")["checks"]) == 30
assert all(read("protected-regression/result.json")["checks"].values())
assert len(read("native-controls-final.json")["controls"]) == 12
assert read("native-controls-final.json")["status"] == "PASS"
for script, directory, report in [
    ("experiments/living/check-session.py", "attempt2", "session-check-final.json"),
    ("experiments/actenon/check-workflow.py", "protected-regression", "protected-check.json"),
]:
    checked = json.loads(subprocess.check_output([sys.executable, "-B", str(root / script), str(evidence / directory)], cwd=root))
    assert checked == read(report)
oracle = read("public-check/result.json")
assert oracle["status"] == "PASS" and all(oracle["checks"].values())
candidate = read("attempt2/goal-0.json")["executed"]["output"]["message"]
publication = read("public-check/publication.json")["message"]
structure = read("public-check/structure.json")
assert candidate["DOI"].lower() == structure["rcsb_primary_citation"]["pdbx_database_id_DOI"].lower()
assert all(candidate[k] == publication[k] for k in ["DOI", "title", "publisher"])
installed = read("installed-fixed-check.json")
assert installed["status"] == "PASS" and installed["records"] == 6 and installed["tools"] == 13
assert len(installed["measurements"]) == 5
assert read("installed-linux.json")["status"] == "PASS"
packaged = {row["path"] for row in read("package-fixed.json")[0]["files"]}
assert {"dist/index.mjs", "dist/edge.js", "dist/rcx.mjs",
    "integrations/actenon/authority-evidence.mjs", "integrations/actenon/authority-evidence.py"} <= packaged
assert "ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING" in (evidence / "installed-check.log").read_text()
assert "AssertionError" in (evidence / "native-controls-2.log").read_text()
assert "EPERM" in (evidence / "native-sandbox-failure.log").read_text()
print(json.dumps({"status": "PASS", "sources": len(manifest["sources"]), "artifacts": len(manifest["artifacts"]),
    "nativeTests": 452, "linuxTests": 63, "proofChecks": 28, "protectedControls": 30,
    "nativeAdapterControls": 12, "sessionCorruptionsRejected": 9,
    "scope": "same-author offline reconciliation plus native proof verification; package runs are preserved observations, no new network/model calls or independent-author review"}, indent=2))

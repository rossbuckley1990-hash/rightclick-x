"""Reconcile this checkpoint's source and raw evidence, without new execution.

Run with the audited Actenon Python environment. This is a same-author integrity
and result check, not independent-author review or a new holdout evaluation.
"""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

root = Path(__file__).resolve().parents[2]
manifest = json.loads(Path(sys.argv[1]).read_text())
digest = lambda data: hashlib.sha256(data).hexdigest()
revision = manifest["productRevision"]
assert re.fullmatch(r"[0-9a-f]{40}", revision)
assert digest(Path(__file__).read_bytes()) == manifest["checkerSha256"]
for name, expected in manifest["sources"].items():
    path = (root / name).resolve()
    assert path.is_relative_to(root)
    frozen = subprocess.check_output(["git", "show", f"{revision}:{name}"], cwd=root)
    assert digest(frozen) == expected == digest(path.read_bytes()), name
for name, expected in manifest["artifacts"].items():
    path = (root / name).resolve()
    assert path.is_relative_to(root) and digest(path.read_bytes()) == expected, name
e = root / "docs/adaptive/evidence/protected-async"
for name, total, passed, failed in [
    ("transport-before.log", 2, 0, 2),
    ("transport-attempt2.log", 7, 6, 1),
    ("http-denial-before.log", 9, 7, 2),
    ("native-final.log", 384, 384, 0),
    ("linux-final.log", 74, 74, 0),
]:
    text = (e / name).read_text()
    for field, value in [("tests", total), ("pass", passed), ("fail", failed), ("skipped", 0)]:
        assert re.search(rf"^ℹ {field} {value}$", text, re.M), (name, field)
assert "PASS: 28/28 checks" in (e / "proof-final.log").read_text()
assert "> tsc -p tsconfig.json" in (e / "types3.log").read_text()
assert "error TS" not in (e / "types3.log").read_text()
assert (e / "build-final.log").read_text().count("Bundled ") == 2
assert "46 passed" in (e / "actenon-reconciliation-tests.log").read_text()
read = lambda name: json.loads((e / name).read_text())
assert "EPERM" in read("proof-sandbox-failed.json")["error"]["message"]
assert read("attempt1/result.json")["checks"]["protected_async_workflow_completed"] is False
checks = read("final/result.json")["checks"]
assert len(checks) == 29 and all(checks.values())
for name, total in [("resource-final", 36), ("lifecycle-final", 23)]:
    result = read(name + "/result.json")
    assert result["passed"] == result["total"] == total and all(result["checks"].values())
for script, directory in [
    ("check-protected-async.py", "final"),
    ("check-resource.py", "resource-final"),
    ("check-changed-lifecycle.py", "lifecycle-final"),
]:
    subprocess.run([sys.executable, str(root / "experiments/actenon" / script), str(e / directory)],
                   cwd=root, check=True, capture_output=True)
print(json.dumps({"status": "PASS", "sources": len(manifest["sources"]),
    "artifacts": len(manifest["artifacts"]), "productRevision": revision,
    "scope": "same-author frozen-source integrity, raw result reconciliation and native public-key checks; no new service or model evaluation"}))

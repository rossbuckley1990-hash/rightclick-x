"""Reconcile the frozen HTTP checkpoint; same-author integrity check, not certification."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

root = Path(__file__).resolve().parents[2]
manifest = json.loads(Path(sys.argv[1]).read_text())
revision = manifest["productRevision"]
assert re.fullmatch(r"[0-9a-f]{40}", revision)
digest = lambda b: hashlib.sha256(b).hexdigest()
for name, expected in manifest["sources"].items():
    path = (root / name).resolve()
    assert path.is_relative_to(root)
    frozen = subprocess.check_output(["git", "show", f"{revision}:{name}"], cwd=root)
    assert digest(frozen) == expected == digest(path.read_bytes()), name
for name, expected in manifest["artifacts"].items():
    path = (root / name).resolve()
    assert path.is_relative_to(root) and digest(path.read_bytes()) == expected, name
e = root / "docs/adaptive/evidence/http-pending"
for name, total, passed, failed in [
    ("before-corrected.log", 4, 0, 4),
    ("native-guard.log", 360, 360, 0),
    ("store-before.log", 2, 0, 2),
    ("native-continuation.log", 373, 372, 1),
    ("native-final.log", 375, 375, 0),
    ("linux-final.log", 76, 76, 0),
    ("native-final2.log", 375, 375, 0),
    ("linux-final2.log", 76, 76, 0),
    ("retry-after-before.log", 13, 12, 1),
]:
    log = (e / name).read_text()
    for field, value in [("tests", total), ("pass", passed), ("fail", failed), ("skipped", 0)]:
        assert re.search(rf"^ℹ {field} {value}$", log, re.M), (name, field)
assert "ENOENT" in (e / "native-continuation.log").read_text()
assert "PASS: 28/28 checks" in (e / "proof-final2.log").read_text()
assert "error TS" not in (e / "types-final2.log").read_text()
assert "> tsc -p tsconfig.json" in (e / "types-final2.log").read_text()
assert (e / "build-final2.log").read_text().count("Bundled ") == 2
read = lambda p: json.loads(p.read_text())
baseline = read(e / "lifecycle-baseline/cold.json")["outcome"]
assert baseline["executed"]["status"] == "pending" and not baseline.get("published")
assert read(e / "lifecycle-baseline/first-transport.json")["code"] == 1
assert read(e / "lifecycle-attempt2/provenance.json")["revision"] == revision
assert read(e / "lifecycle-check2.json")["pass"]
subprocess.run([sys.executable, str(root / "experiments/living/check-async-lifecycle.py"),
                str(e / "lifecycle-attempt2")], check=True, capture_output=True)
raw = (e / "lifecycle-controls2.log").read_text().strip()
_, end = json.JSONDecoder().raw_decode(raw)
controls = json.loads(raw[end:].strip())["negativeControls"]
assert len(controls) == 6 and set(controls.values()) == {"rejected"}
actenon = read(e / "actenon-final2/result.json")["checks"]
assert len(actenon) == 23 and all(actenon.values())
assert read(e / "actenon-check2.log")["verdict"] == "PASS"
print(json.dumps({"status": "PASS", "sources": len(manifest["sources"]), "artifacts": len(manifest["artifacts"]),
    "scope": "frozen source/artifact integrity and recorded result reconciliation; same author, no new service or model evaluation"}))

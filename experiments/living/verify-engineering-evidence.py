"""Read-only artifact/source reconciliation. Same author, not independent certification."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

root = Path(__file__).resolve().parents[2]
manifest = json.loads(Path(sys.argv[1]).read_text())
assert re.fullmatch(r"[0-9a-f]{40}", manifest["productRevision"])
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

evidence = root / "docs/adaptive/evidence"
development = evidence / "environment-discovery"
public = evidence / "living-public"
read = lambda p: json.loads(p.read_text())
for name, count in [("native-final.log", 351), ("linux-final.log", 62)]:
    log = (development / name).read_text()
    assert f"tests {count}" in log and f"pass {count}" in log and "fail 0" in log and "skipped 0" in log
assert "PASS: 28/28 checks" in (development / "proof-final.log").read_text()
assert all(c["exitCode"] == 0 for c in read(development / "final-commands.json"))
assert read(public / "oracle-attempt2/result.json")["status"] == "FAIL", "preserve the wrong primary-citation failure"
for attempt in ["attempt3", "reuse-attempt1"]:
    oracle = read(public / ("oracle-" + attempt) / "result.json")
    assert oracle["status"] == "PASS" and all(oracle["checks"].values())
reuse = public / "reuse-attempt1"
assert read(reuse / "provenance.json")["restored"]["sha256"] == digest((public / "attempt3/state.json").read_bytes())
assert read(reuse / "run-0.json")["status"] == "completed"
assert read(reuse / "provenance.json")["config"]["runs"][0]["args"] == {"entry_id": "4HHB"}
network = read(reuse / "network.json")
assert len(network) == 2 and not (reuse / "learn.json").exists()
assert all("__schema" not in (n.get("body") or "") and "__type" not in (n.get("body") or "") and "swagger-docs" not in n["url"] for n in network)
actenon = read(development / "actenon/result.json")["checks"]
assert len(actenon) == 23 and all(actenon.values())
assert read(development / "actenon-check.log")["verdict"] == "PASS"
cli = read(development / "cli-migration-check-v27.json")
assert cli["expectedSemantics"] == 27 and len(cli["after"]["cases"]) == 19 and not cli["after"]["unmetRequirements"]
assert len(cli["negativeControls"]) == 7 and set(cli["negativeControls"].values()) == {"rejected"}
continuity = read(development / "cli-continuity-check-v27.json")
assert continuity["verdict"] == "PASS" and len(continuity["negativeControls"]) == 5
assert set(continuity["negativeControls"].values()) == {"rejected"}
print(json.dumps({"status": "PASS", "sources": len(manifest["sources"]), "artifacts": len(manifest["artifacts"]),
                  "scope": "source/artifact integrity and recorded result reconciliation by the same author; no fresh provider run or independent-author review"}))

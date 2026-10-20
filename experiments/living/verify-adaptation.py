"""Offline reconciliation of frozen source, failed trials and passing evidence.

This is a separate implementation, not independent authorship or certification.
"""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parents[2]
manifest_path = Path(sys.argv[1]).resolve()
manifest = json.loads(manifest_path.read_text())
evidence = manifest_path.parent
digest = lambda data: hashlib.sha256(data).hexdigest()
read = lambda name: json.loads((evidence / name).read_text())
lines = lambda name: [json.loads(row) for row in (evidence / name).read_text().splitlines()]

for name, expected in manifest["sources"].items():
    path = (root / name).resolve()
    assert path.is_relative_to(root)
    frozen = subprocess.check_output(["git", "show", manifest["engineeringRevision"] + ":" + name], cwd=root)
    assert digest(path.read_bytes()) == digest(frozen) == expected, ("source", name)
for name, expected in manifest["artifacts"].items():
    path = (root / name).resolve()
    assert path.is_relative_to(root)
    assert digest(path.read_bytes()) == expected, ("artifact", name)

for name, count in [("native-final.log", 454), ("linux-final.log", 83), ("focused-final.log", 43)]:
    log = (evidence / name).read_text()
    assert all(s in log for s in [f"tests {count}", f"pass {count}", "fail 0", "cancelled 0", "skipped 0"])
baseline = (evidence / "validity-before-final.log").read_text()
assert all(s in baseline for s in ["tests 2", "pass 0", "fail 2", "descriptor-matches-observation"])
assert "PASS: 28/28 checks" in (evidence / "proof.log").read_text()
controls = read("protected-regression/result.json")["checks"]
assert len(controls) == 30 and all(controls.values())
for script, directory, report in [
    ("experiments/living/check-adaptation.py", "attempt4", "check-passing.json"),
    ("experiments/actenon/check-workflow.py", "protected-regression", "protected-check.json"),
]:
    value = json.loads(subprocess.check_output([sys.executable, "-B", str(root / script), str(evidence / directory)], cwd=root))
    assert value == read(report), ("checker", script)

# Fresh public oracle responses are retained; no additional network request.
oracle = read("public-check-final/result.json")
assert oracle["status"] == "PASS" and all(oracle["checks"].values())
candidate = read("attempt4/goal-0.json")["executed"]["output"]["message"]
publication = read("public-check-final/publication.json")["message"]
structure = read("public-check-final/structure.json")
assert candidate["DOI"].lower() == structure["rcsb_primary_citation"]["pdbx_database_id_DOI"].lower()
assert all(candidate[k] == publication[k] for k in ["DOI", "title", "publisher"])

# Preserve the demonstrated operator gap, then account for every fixed control.
before = read("operator-before/changed-header.json")
assert before["result"]["response"]["status"] == 202
assert before["request"]["headers"] != read("operator-before/approved.json")["headers"]
assert len(read("operator-before/effects-changed-header.json")["effects"]) == 1
assert "changed-header must not receive a proof or dispatch" in (evidence / "operator-before.log").read_text()
after = read("operator-after/result.json")
assert after["status"] == "PASS" and after["effects"] == 1 and after["revokedRefused"]
assert set(after["refusedChanges"]) == {"changed-header", "missing-header", "extra-header", "changed-body", "changed-target", "changed-method"}
for case in after["refusedChanges"]:
    assert read("operator-after/" + case + ".json")["result"]["refused"]
    assert read("operator-after/effects-" + case + ".json")["effects"] == []
assert read("operator-after/exact.json")["response"]["status"] == 202
assert read("operator-after/revoked.json")["refused"]
assert len(lines("operator-after/boundary/provider.jsonl")) == 1
assert len(lines("operator-after/boundary/resource-requests.jsonl")) == 1
assert "AssertionError" in (evidence / "check-final.log").read_text()
assert read("attempt2/adaptation-view-removed-after.json")["goal"]["states"]["validity"]["state"] == "descriptor-matches-observation"
assert read("attempt4/adaptation-view-removed-after.json")["goal"]["states"]["validity"]["state"] == "dependencies-changed"
assert not read("independent-review.json")["independentAuthorReviewPerformed"]
print(json.dumps({"status": "PASS", "sources": len(manifest["sources"]), "artifacts": len(manifest["artifacts"]),
    "nativeTests": 454, "linuxTests": 83, "proofChecks": 28, "protectedControls": 30,
    "exactOperatorControls": 8, "adaptationCorruptionsRejected": 7,
    "scope": "same-author offline reconciliation and native verification; independent holdouts, containment coverage and commercial superiority remain unestablished"}, indent=2))

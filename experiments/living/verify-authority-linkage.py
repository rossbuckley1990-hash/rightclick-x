"""Reproduce the frozen local evidence audit without a network or model."""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parents[2]
manifest_path = Path(sys.argv[1]).resolve()
folder = manifest_path.parent
manifest = json.loads(manifest_path.read_text())
sha = lambda b: hashlib.sha256(b).hexdigest()
for name, digest in manifest["sources"].items():
    path = (root / name).resolve()
    assert path.is_relative_to(root)
    frozen = subprocess.check_output(["git", "show", manifest["engineeringRevision"] + ":" + name], cwd=root)
    assert sha(path.read_bytes()) == sha(frozen) == digest, ("source", name)
for name, digest in manifest["artifacts"].items():
    path = (root / name).resolve()
    assert path.is_relative_to(root) and sha(path.read_bytes()) == digest, ("artifact", name)
for trial in ("attempt1", "attempt2"):
    provenance = json.loads((folder / trial / "provenance.json").read_text())
    for name in manifest["sources"]:
        # Trial source manifests below only include sources present at that
        # freeze; later audit helpers cannot be retroactively counted.
        expected = manifest["trialSources"][trial].get(name)
        if expected:
            frozen = subprocess.check_output(["git", "show", provenance["revision"] + ":" + name], cwd=root)
            assert sha(frozen) == expected, ("trial-source", trial, name)

def load(name):
    spec = importlib.util.spec_from_file_location(name, root / "experiments/living" / (name + ".py"))
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module

link_checker = load("check-authority-links")
combined = load("check-adaptation")
result = combined.check(folder / "attempt2")
links = link_checker.check(folder / "attempt2")
assert links["linkedArtifacts"] == 12 and links["unlinkedArtifacts"] == 2
try:
    link_checker.check(folder / "attempt1")
except AssertionError:
    failed_preserved = True
else:
    raise AssertionError("failed trial was incorrectly promoted")
oracle = json.loads((folder / "oracle-final/structure.json").read_text())["rcsb_primary_citation"]
publication = json.loads((folder / "oracle-final/publication.json").read_text())["message"]
candidate = json.loads((folder / "attempt2/goal-0.json").read_text())["executed"]["output"]
message = (candidate[0] if isinstance(candidate, list) else candidate)["message"]
assert message["DOI"].lower() == oracle["pdbx_database_id_DOI"].lower()
assert message["title"] == publication["title"] and message["publisher"] == publication["publisher"]
for name, count in [("regression.log", 461), ("linux.log", 103), ("focused-final.log", 24)]:
    text = (folder / name).read_text()
    assert f"tests {count}" in text and f"pass {count}" in text and "fail 0" in text and "skipped 0" in text
assert "PASS: 28/28 checks" in (folder / "proof.log").read_text()
protected = json.loads((folder / "protected-regression/result.json").read_text())["checks"]
assert len(protected) == 30 and all(protected.values())
assert len(json.loads((folder / "native-links.json").read_text())["controls"]) == 17
assert len(json.loads((folder / "checker-controls.json").read_text())["controls"]) == 9
assert "fail 2" in (folder / "baseline-context.log").read_text()
assert "fail 1" in (folder / "focused-first.log").read_text()
print(json.dumps({"status": "PASS", "sources": len(manifest["sources"]), "artifacts": len(manifest["artifacts"]),
    "failedTrialPreserved": failed_preserved, "linkage": links, "combined": result,
    "scope": "same-author frozen-source reconciliation, native signatures and saved public readbacks; no independent-author certification"}, indent=2))

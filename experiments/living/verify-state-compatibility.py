"""Reconcile frozen state-compatibility evidence; not independent authorship."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys


def require(ok, message):
    if not ok:
        raise ValueError(message)


root = Path(__file__).resolve().parents[2]
manifest = json.loads(Path(sys.argv[1]).read_text())
sha = lambda b: hashlib.sha256(b).hexdigest()
revision = manifest["productRevision"]
require(sys.flags.optimize == 0, "native checks require assertions")
require(re.fullmatch(r"[0-9a-f]{40}", revision), "invalid revision")
for name, digest in manifest["checkers"].items():
    require(sha((root / name).read_bytes()) == digest, "checker changed: " + name)
paths = ["src", "bin", "test", "experiments/actenon", "experiments/living/state-client.ts",
         "experiments/living/state-compatibility.ts", "proof/run.ts", "proof/real-ai.ts",
         "package.json", "package-lock.json", "tsconfig.json"]
names = subprocess.check_output(["git", "ls-tree", "-r", "--name-only", revision, "--", *paths], cwd=root, text=True).splitlines()
require(set(manifest["sources"]) == {n for n in names if not n.endswith(".md")}, "incomplete source inventory")
for name, expected in manifest["sources"].items():
    path = (root / name).resolve()
    require(path.is_relative_to(root), "source escaped repository")
    frozen = subprocess.check_output(["git", "show", f"{revision}:{name}"], cwd=root)
    require(sha(frozen) == expected == sha(path.read_bytes()), "source mismatch: " + name)
e = root / "docs/adaptive/evidence/state-compatibility"
require(set(manifest["artifacts"]) == {str(p.relative_to(root)) for p in e.rglob("*") if p.is_file()}, "incomplete artifact inventory")
for name, expected in manifest["artifacts"].items():
    path = (root / name).resolve()
    require(path.is_relative_to(e) and sha(path.read_bytes()) == expected, "artifact mismatch: " + name)
read = lambda name: json.loads((e / name).read_text())
require(read("tested-sources.json") == manifest["sources"], "tested bytes differ from freeze")
for name, total, passed in [
    ("baseline-failures.log", 3, 0), ("focused-attempt1.log", 39, 37),
    ("focused-attempt2.log", 39, 39), ("native-attempt1.log", 425, 425), ("linux-attempt1.log", 120, 120),
]:
    output = (e / name).read_text()
    for field, value in [("tests", total), ("pass", passed), ("fail", total - passed), ("skipped", 0), ("cancelled", 0)]:
        require(re.search(rf"^ℹ {field} {value}$", output, re.M), f"{name}: {field}")
for name in ["native-attempt1.log", "linux-attempt1.log"]:
    require("✔ a killed runtime recovers a real HTTP composition from FileStore" in (e / name).read_text(), name + ": missing kill scenario")
types = (e / "types-attempt2.log").read_text()
require("> tsc -p tsconfig.json" in types and "error TS" not in types, "typecheck")
require((e / "build-attempt1.log").read_text().count("Bundled ") == 2, "build")
proof = read("proof-attempt1.json")
require(proof["passed"] == proof["total"] == len(proof["checks"]) == 28 and all(c["passed"] for c in proof["checks"]), "proof")
require(proof["sourceBefore"] == proof["sourceAfter"], "proof source changed")
for name, digest in proof["sourceBefore"]["files"].items():
    require(manifest["sources"].get(name) == digest, "proof source mismatch: " + name)
before = {(r["reader"], r["state"]): r for r in read("before/results.json")["results"]}
require(before["d4c2ac74", "currentEncoding"]["calls"] == 1, "original restriction bypass not preserved")
require(before["current", "naiveVersionBump"]["bytesPreserved"] is False, "original reset not preserved")
for row in read("final/results.json")["results"]:
    if row["reader"] == "current":
        require(row["revision"] == revision, "compatibility experiment source")
protected = read("protected-regression/result.json")["checks"]
require(len(protected) == 30 and all(v is True for v in protected.values()), "protected regression")
require(read("protected-regression/provenance.json")["rcx_commit"] == revision, "protected source")
checked = {}
for name, script, directory, recorded in [
    ("compatibility", "experiments/living/check-state-compatibility.py", "final", "compatibility-check.json"),
    ("nativeAuthority", "experiments/actenon/check-workflow.py", "protected-regression", "protected-check.json"),
]:
    result = subprocess.run([sys.executable, str(root / script), str(e / directory)], cwd=root, check=True, text=True, capture_output=True)
    checked[name] = json.loads(result.stdout)
    require(checked[name] == read(recorded), name + ": separate checker mismatch")
print(json.dumps({"status": "PASS", "productRevision": revision, "sources": len(manifest["sources"]),
    "artifacts": len(manifest["artifacts"]), "checks": checked,
    "scope": "same-author source/result reconciliation, known-reader compatibility and separate native public-key verification; no holdout, new-model or economic claim"}, indent=2))

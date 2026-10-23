"""Reconcile frozen HTTP recovery source, raw results and native proof artifacts.

This is same-author evidence checking. It starts no provider or model and does
not establish independent authorship, a holdout result or economic advantage.
Run with the pinned Actenon Python environment, without optimization.
"""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys


def require(condition, detail):
    if not condition:
        raise ValueError(detail)


root = Path(__file__).resolve().parents[2]
manifest = json.loads(Path(sys.argv[1]).read_text())
digest = lambda data: hashlib.sha256(data).hexdigest()
revision = manifest["productRevision"]
require(sys.flags.optimize == 0, "native artifact checkers require assertions enabled")
require(re.fullmatch(r"[0-9a-f]{40}", revision), "invalid product revision")
require(digest(Path(__file__).read_bytes()) == manifest["checkerSha256"], "checker changed")
paths = ["src", "bin", "test", "experiments/actenon", "proof/run.ts",
         "package.json", "package-lock.json", "tsconfig.json"]
frozen_names = subprocess.check_output(
    ["git", "ls-tree", "-r", "--name-only", revision, "--", *paths], cwd=root,
    text=True).splitlines()
expected_names = {name for name in frozen_names if not name.endswith(".md")}
require(set(manifest["sources"]) == expected_names, "incomplete source inventory")
for name, expected in manifest["sources"].items():
    path = (root / name).resolve()
    require(path.is_relative_to(root), "source outside repository")
    frozen = subprocess.check_output(["git", "show", f"{revision}:{name}"], cwd=root)
    require(digest(frozen) == expected == digest(path.read_bytes()), f"source changed: {name}")

evidence = root / "docs/adaptive/evidence/http-resume"
actual_artifacts = {str(p.relative_to(root)) for p in evidence.rglob("*") if p.is_file()}
require(set(manifest["artifacts"]) == actual_artifacts, "incomplete artifact inventory")
for name, expected in manifest["artifacts"].items():
    path = (root / name).resolve()
    require(path.is_relative_to(evidence) and digest(path.read_bytes()) == expected,
            f"artifact changed: {name}")

for name, total, passed, failed in [
    ("before.log", 2, 0, 2),
    ("selector-attempt1.log", 40, 39, 1),
    ("selector-final.log", 40, 40, 0),
    ("capacity-before.log", 10, 9, 1),
    ("capacity-after.log", 10, 10, 0),
    ("persistence-before.log", 11, 10, 1),
    ("persistence-after.log", 11, 11, 0),
    ("native-final3.log", 396, 396, 0),
    ("linux-final3.log", 88, 88, 0),
]:
    output = (evidence / name).read_text()
    for field, value in [("tests", total), ("pass", passed), ("fail", failed),
                         ("cancelled", 0), ("skipped", 0)]:
        require(re.search(rf"^ℹ {field} {value}$", output, re.M), f"{name}: {field}")
types = (evidence / "types-final3.log").read_text()
require("> tsc -p tsconfig.json" in types and "error TS" not in types, "typecheck output")
require((evidence / "build-final3.log").read_text().count("Bundled ") == 2, "build output")
require("PASS: 28/28 checks" in (evidence / "proof-final3.log").read_text(), "proof output")
read = lambda name: json.loads((evidence / name).read_text())
proof = read("proof-final3.json")
require(proof["passed"] == proof["total"] == len(proof["checks"]) == 28
        and proof["verdict"] == "PASS" and all(c["passed"] is True for c in proof["checks"]),
        "proof checks")
require(proof["sourceBefore"] == proof["sourceAfter"], "proof source drift")
for name, expected in proof["sourceBefore"]["files"].items():
    require(manifest["sources"].get(name) == expected, f"proof source binding: {name}")
legacy = read("legacy-selector.json")
require(legacy["revision"] == manifest["startingRevision"] and legacy["exit"] == 0,
        "baseline selector experiment")
require(json.loads(legacy["stdout"]) == {
    "optionCalls": 2, "selectorRejected": True, "selectorDispatchDelta": 0},
    "baseline selector result")

checker_results = {}
for directory, count, source, checker, recorded in [
    ("actenon-final3", 9, revision, "check-resume.py", "checker-final3.json"),
    ("protected-regression", 29, "1ce3d33ae7e7cbb9387c2128cfe6b9a60d6a9435",
     "check-protected-async.py", "protected-check.json"),
]:
    checks = read(f"{directory}/result.json")["checks"]
    require(len(checks) == count and all(v is True for v in checks.values()),
            f"{directory}: checks")
    require(read(f"{directory}/provenance.json")["rcx_commit"] == source,
            f"{directory}: wrong source revision")
    result = subprocess.run(
        [sys.executable, str(root / "experiments/actenon" / checker), str(evidence / directory)],
        cwd=root, check=True, capture_output=True, text=True)
    checked = json.loads(result.stdout)
    require(checked == read(recorded), f"{directory}: native checker result changed")
    checker_results[directory] = checked

print(json.dumps({
    "status": "PASS", "productRevision": revision,
    "sources": len(manifest["sources"]), "artifacts": len(manifest["artifacts"]),
    "nativeChecks": checker_results,
    "scope": "same-author frozen-source and raw-result reconciliation with separate native public-key checks; no new provider, model, holdout or economic evaluation",
}, indent=2))

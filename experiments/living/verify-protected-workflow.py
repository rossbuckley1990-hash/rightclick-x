"""Retained-source/native-artifact reconciliation, not independent authorship."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys


def require(condition, message):
    if not condition:
        raise ValueError(message)


root = Path(__file__).resolve().parents[2]
manifest = json.loads(Path(sys.argv[1]).read_text())
revision = manifest["productRevision"]
sha = lambda b: hashlib.sha256(b).hexdigest()
require(sys.flags.optimize == 0, "native checkers require assertions")
require(re.fullmatch(r"[0-9a-f]{40}", revision), "invalid revision")
require(sha(Path(__file__).read_bytes()) == manifest["checkerSha256"], "checker changed")
product = ["src", "bin", "test", "package.json", "package-lock.json", "tsconfig.json"]
paths = [*product, "experiments/actenon", "proof/run.ts"]
names = subprocess.check_output(
    ["git", "ls-tree", "-r", "--name-only", revision, "--", *paths], cwd=root, text=True).splitlines()
require(set(manifest["sources"]) == {n for n in names if not n.endswith(".md")}, "incomplete source list")
for name, expected in manifest["sources"].items():
    path = (root / name).resolve()
    require(path.is_relative_to(root), "source outside repository")
    frozen = subprocess.check_output(["git", "show", f"{revision}:{name}"], cwd=root)
    require(sha(frozen) == expected == sha(path.read_bytes()), f"source changed: {name}")
unchanged = subprocess.check_output(
    ["git", "diff", "--name-only", manifest["unchangedProductFrom"], revision, "--", *product], cwd=root, text=True)
require(not unchanged, "product changed from the stated prior test freeze")
e = root / "docs/adaptive/evidence/protected-workflow"
require(set(manifest["artifacts"]) == {str(p.relative_to(root)) for p in e.rglob("*") if p.is_file()},
        "incomplete evidence inventory")
for name, expected in manifest["artifacts"].items():
    path = (root / name).resolve()
    require(path.is_relative_to(e) and sha(path.read_bytes()) == expected, f"artifact changed: {name}")
native = (e / "native.log").read_text()
for field, value in [("tests", 409), ("pass", 409), ("fail", 0), ("cancelled", 0), ("skipped", 0)]:
    require(re.search(rf"^ℹ {field} {value}$", native, re.M), f"native {field}")
types = (e / "types.log").read_text()
require("> tsc -p tsconfig.json" in types and "error TS" not in types, "typecheck output")
require("Protected Mode Docker operation failed: image" in (e / "attempt1.log").read_text(), "preserved setup failure")
read = lambda name: json.loads((e / name).read_text())
for directory, count in [("attempt2", 27), ("attempt3", 28), ("final", 28), ("async-regression", 29)]:
    checks = read(directory + "/result.json")["checks"]
    require(len(checks) == count and all(v is True for v in checks.values()), f"{directory}: checks")
results = {}
for directory, script, recorded in [
    ("final", "check-workflow.py", "checker-final.json"),
    ("async-regression", "check-protected-async.py", "async-check.json"),
]:
    require(read(directory + "/provenance.json")["rcx_commit"] == revision, f"{directory}: source binding")
    checked = subprocess.run([sys.executable, str(root / "experiments/actenon" / script), str(e / directory)],
                             cwd=root, check=True, capture_output=True, text=True)
    results[directory] = json.loads(checked.stdout)
    require(results[directory] == read(recorded), f"{directory}: native checker changed")
print(json.dumps({
    "status": "PASS", "productRevision": revision, "unchangedProductFrom": manifest["unchangedProductFrom"],
    "sources": len(manifest["sources"]), "artifacts": len(manifest["artifacts"]), "nativeChecks": results,
    "scope": "same-author source/result reconciliation and native public-key verification; controlled resource only; no new service, model, independent-author or economic evaluation",
}, indent=2))

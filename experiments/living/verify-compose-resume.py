"""Source-bound result reconciliation; same author, not an independent holdout."""
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
sha = lambda data: hashlib.sha256(data).hexdigest()
revision = manifest["productRevision"]
require(sys.flags.optimize == 0, "native checks require assertions")
require(re.fullmatch(r"[0-9a-f]{40}", revision), "invalid revision")
require(sha(Path(__file__).read_bytes()) == manifest["checkerSha256"], "checker changed")
paths = ["src", "bin", "test", "experiments/actenon", "proof/run.ts",
         "package.json", "package-lock.json", "tsconfig.json"]
names = subprocess.check_output(["git", "ls-tree", "-r", "--name-only", revision, "--", *paths], cwd=root, text=True).splitlines()
require(set(manifest["sources"]) == {n for n in names if not n.endswith(".md")}, "incomplete source inventory")
for name, expected in manifest["sources"].items():
    path = (root / name).resolve()
    require(path.is_relative_to(root), "source escaped repository")
    frozen = subprocess.check_output(["git", "show", f"{revision}:{name}"], cwd=root)
    require(sha(frozen) == expected == sha(path.read_bytes()), f"source changed: {name}")
e = root / "docs/adaptive/evidence/compose-resume"
require(set(manifest["artifacts"]) == {str(p.relative_to(root)) for p in e.rglob("*") if p.is_file()}, "incomplete artifact inventory")
for name, expected in manifest["artifacts"].items():
    path = (root / name).resolve()
    require(path.is_relative_to(e) and sha(path.read_bytes()) == expected, f"artifact changed: {name}")
read = lambda name: json.loads((e / name).read_text())
require(read("tested-sources-final.json") == manifest["sources"], "pre-commit tested bytes differ from freeze")
for name, total in [("native-final2.log", 418), ("linux-final2.log", 113), ("focused-final.log", 19)]:
    output = (e / name).read_text()
    for key, value in [("tests", total), ("pass", total), ("fail", 0), ("skipped", 0), ("cancelled", 0)]:
        require(re.search(rf"^ℹ {key} {value}$", output, re.M), f"{name}: {key}")
for name in ["native-final2.log", "linux-final2.log"]:
    require("✔ a killed runtime recovers a real HTTP composition from FileStore" in (e / name).read_text(), f"{name}: missing killed composition")
require("workflow-pending" in (e / "baseline-failure.log").read_text() and "ℹ fail 1" in (e / "baseline-failure.log").read_text(), "missing original failure")
require("AssertionError" in (e / "protected-attempt1.log").read_text(), "missing harness-count failure")
require("ℹ fail 1" in (e / "output-view-failure.log").read_text(), "missing output-view failure")
require("EPERM" in (e / "native-attempt1.log").read_text(), "missing sandbox failure")
types = (e / "types-final.log").read_text()
require("> tsc -p tsconfig.json" in types and "error TS" not in types, "typecheck")
require((e / "build-final2.log").read_text().count("Bundled ") == 2, "build")
require("PASS: 28/28 checks" in (e / "proof-final2.log").read_text(), "proof")
proof = read("proof-final2.json")
require(proof["passed"] == proof["total"] == len(proof["checks"]) == 28 and all(c["passed"] for c in proof["checks"]), "proof results")
require(proof["sourceBefore"] == proof["sourceAfter"], "proof source changed")
for name, digest in proof["sourceBefore"]["files"].items():
    require(manifest["sources"].get(name) == digest, f"proof source mismatch: {name}")
native = {}
for directory, total, script, recorded in [
    ("protected-final2", 30, "check-workflow.py", "protected-check-final2.json"),
    ("async-regression2", 29, "check-protected-async.py", "async-check2.json"),
]:
    checks = read(directory + "/result.json")["checks"]
    require(len(checks) == total and all(v is True for v in checks.values()), f"{directory}: checks")
    require(read(directory + "/provenance.json")["rcx_commit"] == revision, f"{directory}: source revision")
    checked = subprocess.run([sys.executable, str(root / "experiments/actenon" / script), str(e / directory)], cwd=root, check=True, capture_output=True, text=True)
    native[directory] = json.loads(checked.stdout)
    require(native[directory] == read(recorded), f"{directory}: native checker mismatch")
print(json.dumps({"status": "PASS", "productRevision": revision, "sources": len(manifest["sources"]),
    "artifacts": len(manifest["artifacts"]), "nativeChecks": native,
    "scope": "same-author source/result reconciliation, separate native public-key checking; no independent-author, fresh-model or economic claim"}, indent=2))

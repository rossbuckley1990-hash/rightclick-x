"""Reconcile retained development evidence; no new provider/model evaluation."""
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
sha = lambda data: hashlib.sha256(data).hexdigest()
require(sys.flags.optimize == 0, "native checker requires assertions enabled")
require(re.fullmatch(r"[0-9a-f]{40}", revision), "invalid revision")
require(sha(Path(__file__).read_bytes()) == manifest["checkerSha256"], "checker changed")
paths = ["src", "bin", "test", "experiments/actenon", "proof/run.ts",
         "package.json", "package-lock.json", "tsconfig.json"]
names = subprocess.check_output(
    ["git", "ls-tree", "-r", "--name-only", revision, "--", *paths], cwd=root, text=True).splitlines()
require(set(manifest["sources"]) == {n for n in names if not n.endswith(".md")}, "incomplete source list")
for name, expected in manifest["sources"].items():
    path = (root / name).resolve()
    require(path.is_relative_to(root), "source path escapes repository")
    frozen = subprocess.check_output(["git", "show", f"{revision}:{name}"], cwd=root)
    require(sha(frozen) == expected == sha(path.read_bytes()), f"source mismatch: {name}")
e = root / "docs/adaptive/evidence/workflow-resume"
require(set(manifest["artifacts"]) == {str(p.relative_to(root)) for p in e.rglob("*") if p.is_file()},
        "incomplete artifact list")
for name, expected in manifest["artifacts"].items():
    path = (root / name).resolve()
    require(path.is_relative_to(e) and sha(path.read_bytes()) == expected, f"artifact mismatch: {name}")
for name, total, passed, failed in [
    ("before.log", 2, 0, 2), ("focused-final.log", 11, 10, 1),
    ("linux-final.log", 95, 94, 1), ("focused2.log", 12, 12, 0),
    ("native2.log", 409, 409, 0), ("linux2.log", 96, 96, 0),
]:
    output = (e / name).read_text()
    for field, value in [("tests", total), ("pass", passed), ("fail", failed), ("skipped", 0), ("cancelled", 0)]:
        require(re.search(rf"^ℹ {field} {value}$", output, re.M), f"{name}: {field}")
for name in ["native2.log", "linux2.log"]:
    require("✔ a killed runtime recovers a real HTTP workflow from FileStore" in (e / name).read_text(),
            f"{name}: missing process-kill scenario")
types = (e / "types4.log").read_text()
require("> tsc -p tsconfig.json" in types and "error TS" not in types, "typecheck output")
require((e / "build.log").read_text().count("Bundled ") == 2, "build output")
require("PASS: 28/28 checks" in (e / "proof.log").read_text(), "proof log")
read = lambda name: json.loads((e / name).read_text())
proof = read("proof.json")
require(proof["passed"] == proof["total"] == len(proof["checks"]) == 28
        and all(c["passed"] is True for c in proof["checks"]), "proof checks")
require(proof["sourceBefore"] == proof["sourceAfter"], "source drift during proof")
for name, digest in proof["sourceBefore"]["files"].items():
    require(manifest["sources"].get(name) == digest, f"proof source binding: {name}")
checks = read("actenon-regression/result.json")["checks"]
require(len(checks) == 9 and all(v is True for v in checks.values()), "Actenon regression")
require(read("actenon-regression/provenance.json")["rcx_commit"] == revision, "Actenon source binding")
native = subprocess.run(
    [sys.executable, str(root / "experiments/actenon/check-resume.py"), str(e / "actenon-regression")],
    cwd=root, check=True, capture_output=True, text=True)
require(json.loads(native.stdout) == read("actenon-check.json"), "native artifact check changed")
print(json.dumps({
    "status": "PASS", "productRevision": revision, "sources": len(manifest["sources"]),
    "artifacts": len(manifest["artifacts"]), "nativeArtifactCheck": json.loads(native.stdout),
    "scope": "same-author source integrity and retained result reconciliation; Actenon check covers the prior HTTP leaf profile, not new workflow enforcement; no independent-author, holdout or economic claim",
}, indent=2))

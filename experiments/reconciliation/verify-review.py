"""Verify retained PR-review results, provenance and unchanged acceptance criteria."""
from pathlib import Path
import hashlib
import json
import re
import subprocess

root = Path(__file__).resolve().parents[2]
e = root / "docs/reconciliation/pr3-review"
load = lambda name: json.loads((e / name).read_text())
p = load("provenance.json")
for table in [p["files"], load("sha256.json")]:
    for name, expected in table.items():
        assert hashlib.sha256((root / name).read_bytes()).hexdigest() == expected, name
for name, counts in [("baseline-complete", {"tests": 12, "pass": 3, "fail": 9, "skipped": 0}),
                     ("regression-verified", {"tests": 165, "pass": 165, "fail": 0, "skipped": 0, "cancelled": 0})]:
    log = (e / (name + ".log")).read_text()
    for metric, value in counts.items():
        assert re.search(r"(?:ℹ|#) " + metric + " " + str(value) + r"\b", log), (name, metric)
assert load("baseline-complete.command.json")["exit_code"] == 1
for name in ["review-before", "review-baseline", "full-regression", "regression-final", "acceptance-final"]:
    assert load(name + ".command.json")["exit_code"] != 0, name
for name in ["regression-verified", "typecheck-verified", "build-verified", "acceptance-verified", "lifecycle-verified"]:
    assert load(name + ".command.json")["exit_code"] == 0, name
a = load("acceptance-verified.json")
assert a["passed"] == 24 and a["failed"] == 0 and len(a["checks"]) == 24
assert all(c["ok"] for c in a["checks"])
l = load("lifecycle-verified.json")
assert l["passed"] == l["total"] == 28 and l["verdict"] == "PASS"
assert l["sourceBefore"] == l["sourceAfter"]
for name, digest in l["sourceBefore"]["files"].items():
    assert p["files"][name] == digest, name
subprocess.run(["git", "diff", "--exit-code", p["product_commit"], "--", "src", "bin", "test", "demo", "package.json", "package-lock.json", "tsconfig.json"], cwd=root, check=True)
print("Verified review source/evidence hashes: original 3/12 -> corrected 12/12 review controls, 165 regressions, 24 discovery checks, 28 lifecycle checks.")
print("Preserved failures remain failures. This is not a new unfamiliar-software holdout or release approval.")

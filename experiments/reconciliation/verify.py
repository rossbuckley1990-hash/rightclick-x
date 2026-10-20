"""Read-only integrity/attribution check; does not replace rerunning tests or independent review."""
import hashlib
import json
from pathlib import Path
import re
import subprocess

root = Path(__file__).resolve().parents[2]
evidence = root / "docs/reconciliation/20261020"
load = lambda name: json.loads((evidence / name).read_text())
provenance = load("provenance.json")
for mapping in [provenance["files"], load("sha256.json")]:
    for name, expected in mapping.items():
        assert hashlib.sha256((root / name).read_bytes()).hexdigest() == expected, name

for name in ["regression-integration.log", "linux/regression.log"]:
    log = (evidence / name).read_text()
    for metric, count in [("tests", 153), ("pass", 153), ("fail", 0), ("skipped", 0), ("cancelled", 0)]:
        assert re.search(r"(?:ℹ|#) " + metric + r" " + str(count) + r"\b", log), (name, metric)
for name in ["acceptance-integration.json", "linux/acceptance.json"]:
    result = load(name)
    assert result["passed"] == 24 and result["failed"] == 0, name
    assert len(result["checks"]) == 24 and all(c["ok"] for c in result["checks"]), name
for name in ["lifecycle.json", "linux/lifecycle.json"]:
    result = load(name)
    assert result["passed"] == result["total"] == 28 and result["verdict"] == "PASS", name
    assert result["sourceBefore"] == result["sourceAfter"], name
    for path, digest in result["sourceBefore"]["files"].items():
        assert provenance["files"][path] == digest, (name, path)
for name in ["negative-controls.json", "linux/negative-controls.json"]:
    result = load(name)
    assert len(result["results"]) == 6 and all(r["verdict"] == "PASS" for r in result["results"]), name
    assert result["build"] == provenance["product_commit"], name
for name in ["regression-integration", "typecheck-integration", "acceptance-integration", "build", "lifecycle", "negative-controls", "bundle-smoke", "workflow-syntax", "linux-container"]:
    assert load(name + ".command.json")["exit_code"] == 0, name
# A failed historical whitespace check is evidence, not a suppressed product failure.
assert load("historical-evidence-whitespace.command.json")["exit_code"] == 2
scans = load("secret-scan-summary.json")["scans"]
assert len(scans) == 4
for scan in scans:
    assert scan["scanner_exit"] == (1 if scan["findings"] else 0)
    assert scan["findings"] == scan["classified_digest_entries"]
    assert scan["unclassified"] == 0
preserved = load("preservation-check.json")
assert preserved["original_worktrees"] == 11 and preserved["verified_entries"] == 24787
assert preserved["changed_original_files"] == 0 and preserved["all_original_heads_branches_statuses_unchanged"]
assert preserved["main"] == provenance["starting_local_main"]
assert preserved["github_main_fetched"] == provenance["fetched_github_main"]

for parent in [provenance["starting_local_main"], provenance["fetched_github_main"], provenance["security_parent"], provenance["product_commit"]]:
    subprocess.run(["git", "merge-base", "--is-ancestor", parent, "HEAD"], cwd=root, check=True)
subprocess.run(["git", "diff", "--exit-code", provenance["product_commit"], "--", "src", "bin", "test", "demo", "proof", "package.json", "package-lock.json", "tsconfig.json", ".github/workflows", ".gitignore"], cwd=root, check=True)
print("Verified artifact/source hashes, ancestry, retained failure and recorded preservation checks.")
print("macOS/Linux: 153/153 regressions, 24/24 discovery, 28/28 lifecycle, 6/6 negative controls; zero regression skips.")
print("This verifies recorded evidence. It is not new independent review, holdout evaluation or release approval.")

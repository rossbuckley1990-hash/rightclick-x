"""Verify preserved final-main integration evidence, without running providers or mutating files."""
import hashlib
import json
from pathlib import Path
import re
import subprocess

root = Path(__file__).resolve().parents[2]
evidence = root / "docs/sse-discovery/main-integration"
load = lambda name: json.loads((evidence / name).read_text())
manifest = load("sha256.json")
provenance = load("provenance.json")
for paths in [manifest, provenance["files"]]:
    for path, expected in paths.items():
        assert hashlib.sha256((root / path).read_bytes()).hexdigest() == expected, path

for name in ["acceptance.json", "linux-acceptance.json"]:
    result = load(name)
    assert result["passed"] == 24 and result["failed"] == 0, name
    assert len(result["checks"]) == 24 and all(c["ok"] for c in result["checks"]), name
for name, count in [("full-regression", 148), ("linux-regression", 148), ("baseline-regression", 116)]:
    log = (evidence / (name + ".log")).read_text()
    for metric, expected in [("tests", count), ("pass", count), ("fail", 0), ("skipped", 0), ("cancelled", 0)]:
        assert re.search(r"(?:ℹ|#) " + metric + r" " + str(expected) + r"\b", log), (name, metric)
for name in ["full-regression", "linux-regression", "baseline-regression", "acceptance", "linux-acceptance", "typecheck", "build", "proof", "candidate-wire", "baseline-wire", "graphql-wire"]:
    assert load(name + ".command.json")["exit_code"] == 0, name

proof = load("proof.json")
assert proof["passed"] == proof["total"] == 28 and proof["verdict"] == "PASS"
assert proof["sourceBefore"] == proof["sourceAfter"]
wire = load("candidate-wire.json")
assert len(wire) == 4
for row in wire:
    assert not row["timedOut"] and row["exit"]["code"] == 0
    assert row["result"]["capabilities"] == ["mcp:wire-fixture:read-record"]
    assert row["result"]["run"] == {"status": "completed", "output": "record-17"}
    assert sum(t["event"] == "request" and t.get("rpc") == "tools/call" for t in row["trace"]) == 1
    if row["mode"] == "get-subscription":
        assert any(t["event"] == "response-closed" and t.get("method") == "GET" for t in row["trace"])
baseline = load("baseline-wire.json")
assert len(baseline) == 4
assert all(row["timedOut"] for row in baseline if row["mode"] != "finite-json")
assert next(row for row in baseline if row["mode"] == "finite-json")["result"]["run"]["output"] == "record-17"
for row in load("graphql-wire.json"):
    assert row["exit"]["code"] == 0
    assert any(c.endswith("query:geocode") for c in row["result"]["capabilities"])
    assert any(c.endswith("query:country") for c in row["result"]["capabilities"])
    assert row["result"]["run"]["status"] == "completed"
    assert row["result"]["run"]["output"]["countryCode"] == "JP"
assert load("risk-before.command.json")["exit_code"] == 1
assert load("worktrees-before.json") == load("worktrees-after.json")
subprocess.run(["git", "diff", "--exit-code", provenance["product_commit"], "--", "src", "test", "bin", "demo", "proof", "package.json", "package-lock.json", "tsconfig.json"], cwd=root, check=True)
print(f"Verified {len(manifest)} artifact hashes and {len(provenance['files'])} source/config/harness hashes.")
print("Final candidate: 24/24 acceptance on macOS and Linux; 148/148 regressions on each; 28/28 lifecycle; typecheck and both builds passed.")
print("Exact MCP and GraphQL outcomes, one execution per MCP wire case, preserved negative evidence and unchanged concurrent work reconciled.")

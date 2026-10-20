"""Offline source/result reconciliation; no model or public-provider calls."""
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys

root = Path(__file__).resolve().parents[2]
manifest = json.loads(Path(sys.argv[1]).read_text())
evidence = root / "docs/adaptive/evidence/fresh-public-reuse"
sha = lambda data: hashlib.sha256(data).hexdigest()


def require(ok, message):
    if not ok:
        raise ValueError(message)


def read(name):
    return json.loads((evidence / name).read_text())


revision = manifest["productRevision"]
require(sys.flags.optimize == 0, "native checks require assertions")
require(re.fullmatch("[0-9a-f]{40}", revision), "invalid revision")
for name, digest in manifest["checkers"].items():
    require(sha((root / name).read_bytes()) == digest, "checker changed: " + name)
paths = ["src", "bin", "test", "experiments/actenon", "experiments/living",
         "experiments/north-star/codex-session.ts", "experiments/north-star/codex-preflight.py",
         "experiments/north-star/common.ts", "experiments/north-star/quota.ts",
         "proof/run.ts", "package.json", "package-lock.json", "tsconfig.json"]
names = subprocess.check_output(["git", "ls-tree", "-r", "--name-only", revision, "--", *paths], cwd=root, text=True).splitlines()
require(set(manifest["sources"]) == {name for name in names if not name.endswith(".md")}, "source inventory incomplete")
for name, digest in manifest["sources"].items():
    frozen = subprocess.check_output(["git", "show", f"{revision}:{name}"], cwd=root)
    require(sha(frozen) == digest == sha((root / name).read_bytes()), "source changed: " + name)
require(read("tested-sources.json") == manifest["sources"], "tested sources differ")
require(set(manifest["artifacts"]) == {str(p.relative_to(root)) for p in evidence.rglob("*") if p.is_file()}, "artifact inventory incomplete")
for name, digest in manifest["artifacts"].items():
    path = (root / name).resolve()
    require(path.is_relative_to(evidence) and sha(path.read_bytes()) == digest, "artifact changed: " + name)
for name, tests, passed in [("transport-attempt1.log", 4, 3), ("missing-data-before2.log", 3, 0),
                           ("missing-data-after1.log", 48, 48), ("native-remediation.log", 432, 432),
                           ("linux-remediation.log", 127, 127)]:
    text = (evidence / name).read_text()
    for field, count in [("tests", tests), ("pass", passed), ("fail", tests - passed), ("skipped", 0), ("cancelled", 0)]:
        require(re.search(rf"^ℹ {field} {count}$", text, re.M), f"{name}: {field}")
types = (evidence / "types-remediation.log").read_text()
require("> tsc -p tsconfig.json" in types and "error TS" not in types, "typecheck")
require((evidence / "build-remediation.log").read_text().count("Bundled ") == 2, "build")
proof = read("proof-remediation.json")
require(proof["passed"] == proof["total"] == len(proof["checks"]) == 28 and all(c["passed"] for c in proof["checks"]), "proof")
require(proof["sourceBefore"] == proof["sourceAfter"], "proof source changed")
for name, digest in proof["sourceBefore"]["files"].items():
    require(manifest["sources"].get(name) == digest, "proof source differs: " + name)

spec = importlib.util.spec_from_file_location("fresh_checker", root / "experiments/living/check-fresh-public-reuse.py")
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)
final = evidence / "attempt3"
provenance = read("attempt3/provenance.json")
require(provenance["revision"] == revision, "final model source differs")
for name, digest in provenance["sources"].items():
    require(sha(subprocess.check_output(["git", "show", f"{revision}:{name}"], cwd=root)) == digest == sha((root / name).read_bytes()), "model source differs: " + name)
require(sha((root / provenance["config"]["retained"]).read_bytes()) == provenance["retainedSha256"], "acquisition state changed")
sessions = read("attempt3/sessions.json")
require([s["task"] for s in sessions] == provenance["config"]["sessions"], "task set changed")
rows = []
for session in sessions:
    task = session["task"]; directory = final / task["id"]
    requests = checker.jsonl(directory / "network.jsonl")
    for request in requests:
        if "sha256" in request:
            data = (directory / f'response-{request["id"]}.bin').read_bytes()
            require(sha(data) == request["sha256"] and len(data) == request["bytes"], "response changed")
    rows.append({"session": session, "network": requests, "mcp": checker.jsonl(directory / "mcp.jsonl"),
                 "events": checker.jsonl(directory / "agent.stdout"), "audit": json.loads((directory / "agent-audit.json").read_text())})
expected = read("oracle-final/expected.json")
for task in provenance["config"]["sessions"]:
    if task["expected"] != "publication":
        continue
    structure = read(f'oracle-final/{task["id"]}-structure.json')
    publication = read(f'oracle-final/{task["id"]}-publication.json')["message"]
    doi = structure["rcsb_primary_citation"]["pdbx_database_id_DOI"]
    require(publication["DOI"].lower() == doi.lower(), "oracle returned another publication")
    require(expected[task["id"]] == {"doi": doi, "title": publication["title"], "publisher": publication["publisher"]}, "oracle expectation differs")
checked = checker.verify(rows, expected)
result = read("oracle-final/result.json")
require(result["status"] == "PASS" and result["checked"] == checked and len(result["corruptionsRejected"]) == 6, "final checker result differs")
require(read("oracle-attempt1/result.json")["status"] == "FAIL" and read("oracle-attempt1/result.json")["error"] == "contract rediscovery", "runtime failure missing")
original = read("attempt1/sessions.json")
require(len(original) == 1 and "non-benchmark tool" in original[0]["blocked"], "transport failure missing")
require(read("audit-prefix-diagnostic.json")["correctedPrefixViolations"] == [], "prefix diagnosis missing")

all_sessions = []
thread_ids = set()
for attempt in ["attempt1", "attempt2", "attempt3"]:
    require(read(attempt + "/provenance.json")["config"] == provenance["config"], "trial tasks changed")
    for session in read(attempt + "/sessions.json"):
        directory = evidence / attempt / session["task"]["id"]
        account = json.loads((directory / "preflight/preflight.json").read_text())["responses"]
        limit = account["account/rateLimits/read"]
        bucket = limit["rateLimitsByLimitId"]["codex"]
        require(account["account/read"]["type"] == "chatgpt" and limit["ordinaryUsageAllowed"] is True and
                bucket["credits"] == {"hasCredits": False, "unlimited": False, "balance": "0"} and bucket["primary"]["usedPercent"] < 90, "no-spend preflight missing")
        audit = json.loads((directory / "agent-audit.json").read_text())
        require(audit["threadId"] not in thread_ids, "model thread reused between trials")
        thread_ids.add(audit["threadId"])
        events = checker.jsonl(directory / "agent.stdout")
        turns = [item["usage"] for item in events if item["type"] == "turn.completed"]
        require(turns and sum(u["input_tokens"] + u["output_tokens"] for u in turns) == session["tokens"], "all-attempt usage mismatch")
        all_sessions.append(session)
require(len(all_sessions) == 9, "attempt count differs")
protected = read("protected-regression/result.json")["checks"]
require(len(protected) == 30 and all(v is True for v in protected.values()), "protected workflow failed")
require(read("protected-regression/provenance.json")["rcx_commit"] == revision, "protected source differs")
native = subprocess.run([sys.executable, str(root / "experiments/actenon/check-workflow.py"), str(evidence / "protected-regression")],
                        cwd=root, capture_output=True, text=True, check=True)
require(json.loads(native.stdout) == read("protected-check.json"), "native check differs")
print(json.dumps({"status": "PASS", "productRevision": revision, "sources": len(manifest["sources"]),
    "artifacts": len(manifest["artifacts"]), "finalTrial": checked, "allAttempts": {"modelSessions": len(all_sessions),
    "reportedTokens": sum(s["tokens"] for s in all_sessions), "sessionSeconds": round(sum(s["seconds"] for s in all_sessions), 1)},
    "scope": "same-author offline reconciliation plus separate native proof verification; public readbacks share underlying providers; no independent-author holdout or economic comparison"}, indent=2))

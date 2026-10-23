"""Offline audit of all retained trials, failures and their separate outcome checks.

Same author as the implementation. Hashes detect changed evidence; they are not
third-party attestations or a replacement for independent authorship/review.
"""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]


def require(ok, message):
    if not ok:
        raise ValueError(message)


def read(path):
    return json.loads(path.read_text())


def safe(name):
    path = (ROOT / name).resolve()
    require(path.is_relative_to(ROOT) and path.is_file(), "invalid artifact path")
    return path


def main():
    manifest = read(Path(sys.argv[1]))
    for name, digest in manifest["files"].items():
        require(hashlib.sha256(safe(name).read_bytes()).hexdigest() == digest, "changed artifact: " + name)
    results, tokens, seconds, sessions_count = {}, 0, 0.0, 0
    identities = set()
    with tempfile.TemporaryDirectory(prefix="rcx-reuse-audit-") as tmp:
        for trial in manifest["trials"]:
            directory = ROOT / trial["directory"]
            provenance = read(directory / "provenance.json")
            for name, digest in provenance["sources"].items():
                raw = subprocess.check_output(["git", "show", provenance["revision"] + ":" + name], cwd=ROOT)
                require(hashlib.sha256(raw).hexdigest() == digest, "frozen source mismatch")
            rows = read(directory / "sessions.json")
            require([r["task"] for r in rows] == provenance["config"]["tasks"][:len(rows)], "changed trial order")
            for row in rows:
                path = directory / row["task"]["id"]
                audit = read(path / "agent-audit.json")
                require(audit["threadId"] not in identities, "session not fresh"); identities.add(audit["threadId"])
                events = [json.loads(s) for s in (path / "agent.stdout").read_text().splitlines() if s]
                usage = [e["usage"] for e in events if e["type"] == "turn.completed"]
                require(usage and sum(u["input_tokens"] + u["output_tokens"] for u in usage) == row["tokens"], "stopped/complete trial usage mismatch")
                tokens += row["tokens"]; seconds += row["seconds"]; sessions_count += 1
                preflight = read(path / "preflight/preflight.json")
                responses = preflight["responses"]; limits = responses["account/rateLimits/read"]; bucket = limits["rateLimitsByLimitId"]["codex"]
                require(preflight["passed"] and responses["account/read"]["type"] == "chatgpt" and limits["ordinaryUsageAllowed"] is True and 0 <= bucket["primary"]["usedPercent"] < 90, "allowance preflight failed")
                require(bucket["credits"] == {"hasCredits": False, "unlimited": False, "balance": "0"}, "credits not disabled")
            if trial["kind"] == "complete":
                target = Path(tmp) / (trial["name"] + ".json")
                subprocess.run([sys.executable, "-B", "experiments/living/check-reuse-comparison.py", "verify", str(directory), str(ROOT / manifest["oracle"]), str(target)], cwd=ROOT, check=True, stdout=subprocess.PIPE)
                checked = read(target)
                require(checked == read(ROOT / trial["result"]), "stored score differs from fresh check")
                require(checked["status"] == "PASS", "business outcome failed")
                results[trial["name"]] = checked["aggregate"]
                if trial.get("equalRetention"):
                    directive = "After obtaining a correct result, save a parameterised reusable solution for subsequent fresh agents, using your arm's persistence mechanism. Do not save the current answer as the solution."
                    require(all(directive in (directory / r["task"]["id"] / "prompt.txt").read_text() for r in rows), "retention instruction changed")
            else:
                require(trial["kind"] == "stopped" and len(rows) == 2 and rows[-1].get("blocked") and not (directory / "finished.json").exists(), "stopped attempt lost")
                require(read(directory / "cold-d/agent-audit.json")["violations"] == ["general execution primitive: manual review required"], "original audit failure missing")
                require(read(directory / "cold-d/agent-exit.json") == {"code": 0, "timedOut": False}, "unexpected stopped trial cause")
    require(read(ROOT / manifest["failedScore"])["aggregate"]["C"]["correct"] == 0, "initial scoring failure not preserved")
    require("fail 5" in (ROOT / manifest["documentBaseline"]).read_text(), "document baseline failures missing")
    print(json.dumps({"status": "PASS", "files": len(manifest["files"]), "freshSessions": sessions_count,
                      "allReportedTokens": tokens, "allModelSeconds": round(seconds, 1), "completedTrialResults": results,
                      "scope": "offline same-author evidence audit; stopped attempt counted, no independent-author or superiority claim"}, indent=2))


if __name__ == "__main__":
    main()

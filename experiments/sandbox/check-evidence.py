"""Post-hoc consistency check of this exposed diagnostic, not independent author review."""
import hashlib
import json
import pathlib
import statistics
import sys

root = pathlib.Path(sys.argv[1])
read = lambda name: json.loads((root / name).read_text())
checks = []


def require(label, condition):
    if not condition:
        raise AssertionError(label)
    checks.append(label)


baseline = read("baseline-probes.json")["rows"]
candidate = read("candidate-probes.json")["rows"]
require("baseline fast allocation exceeded recorded RSS budget and completed", baseline[1]["measured"]["peakRSS"] > baseline[1]["budgetMiB"] * 1024**2 and baseline[1]["result"]["code"] == 0 and baseline[1]["measured"]["done"])
require("baseline held allocation exceeded recorded peak budget and completed", baseline[3]["measured"]["peakRSS"] > baseline[3]["budgetMiB"] * 1024**2 and baseline[3]["result"]["code"] == 0)
require("candidate retains fast memory escape", candidate[1]["measured"]["peakRSS"] > candidate[1]["budgetMiB"] * 1024**2 and candidate[1]["result"]["code"] == 0 and "limit" not in candidate[1]["result"])
require("candidate small control completes", candidate[0]["result"]["code"] == 0 and candidate[0]["measured"]["done"])
require("candidate held controls stopped by memory watchdog", all(row["result"].get("limit") == "memory" for row in candidate[2:]))
observer = read("baseline-observer-loss.json")
require("baseline observer failure completed without refusal", observer["result"]["code"] == 0 and "limit" not in observer["result"])
require("64 MiB rlimits failed before allocations", all(r["result"]["code"] == 77 and not r["result"]["stdout"] for r in read("rlimit-probes.json")["rows"]))
for name, passed, failed in [("observer-tests-before.log", 0, 5), ("native-final.log", 308, 0), ("linux-focused.log", 33, 1), ("linux-focused-final.log", 34, 0), ("native-observer-final.log", 14, 0)]:
    log = (root / name).read_text()
    require(name, f"pass {passed}\n" in log and f"fail {failed}\n" in log and "skipped 0\n" in log)
require("required commands passed", all(r["exitCode"] == 0 for r in read("final-commands.json")))
require("28 proof checks passed", "PASS: 28/28 checks" in (root / "proof-final.log").read_text())
containers = read("container-memory/result.json")["rows"]
for row in containers:
    limits = json.loads(row["stdout"].splitlines()[0])
    require(f"container {row['mib']} MiB has actual 64 MiB/no-swap cgroup", limits == {"memoryMax": "67108864", "swapMax": "0"})
    require(f"container {row['mib']} MiB cleaned up", row["cleanup"] == row["container"])
require("small container control completes without OOM", containers[0]["exitCode"] == 0 and not containers[0]["state"]["OOMKilled"] and json.loads(containers[0]["stdout"].splitlines()[1])["done"])
require("oversized container allocation killed without success output", containers[1]["exitCode"] == 137 and containers[1]["state"]["OOMKilled"] and len(containers[1]["stdout"].splitlines()) == 1)
pairs = []
for pair in range(1, 4):
    medians = {}
    for label in ("before", "after"):
        rows = read(f"isolated-latency-{pair}-{label}.json")["rows"]
        require(f"latency {pair}/{label}: 30 exact outputs without refusal", len(rows) == 30 and all(r["result"]["code"] == 0 and r["result"]["stdout"] == "bounded-launch-cost\n" and "limit" not in r["result"] for r in rows))
        medians[label] = statistics.median(r["elapsedMs"] for r in rows)
    pairs.append({"pair": pair, **medians, "ratio": medians["after"] / medians["before"], "addedMs": medians["after"] - medians["before"]})
print(json.dumps({"scope": "same-author separate Python consistency check; exposed records, no independent final evaluator", "checksPassed": len(checks), "checks": checks, "latencyPairs": pairs, "memoryGate": "FAIL", "commercialAdvantage": "not established"}, indent=2))

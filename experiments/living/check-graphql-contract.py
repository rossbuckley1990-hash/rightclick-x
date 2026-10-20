"""Separate accounting implementation; same author, not independent-author review."""
from functools import lru_cache
import hashlib
import io
import json
import math
from pathlib import Path
import statistics
import subprocess
import sys
import tarfile

ROOT = Path(__file__).resolve().parents[2]
BASELINE = "990ea9f321dec2f5716386db729efc3d7f8ee9b6"
FINAL = "d1f21d0116b75710784078ecc39b4e42043996ff"
CANDIDATES = {"02ae9a500c864ee28043dce7bced991dc381fe02", "7848c3c158421c5070e18b69b2be761f0fe6cfa9", FINAL}
ORDER = ["baseline", "candidate", "candidate", "baseline", "baseline", "candidate"]
FIXTURE = "docs/adaptive/evidence/reuse-comparison-attempt3/cold-d/"


def insist(ok, message):
    if not ok:
        raise ValueError(message)


@lru_cache(maxsize=4)
def tree_hash(revision):
    data = subprocess.check_output(["git", "archive", revision, "src", "package.json"], cwd=ROOT)
    digest = hashlib.sha256()
    with tarfile.open(fileobj=io.BytesIO(data)) as archive:
        for entry in sorted((e for e in archive.getmembers() if e.isfile()), key=lambda e: e.name):
            digest.update(entry.name.encode() + b"\0")
            digest.update(archive.extractfile(entry).read())
            digest.update(b"\0")
    return digest.hexdigest()


@lru_cache(maxsize=8)
def fixture(name):
    return subprocess.check_output(["git", "show", f"{BASELINE}:{FIXTURE}{name}"], cwd=ROOT)


def check_result(result, arm, revision):
    requests = [r["args"] for r in map(json.loads, fixture("mcp.jsonl").splitlines())
                if r["tool"] == "context_run" and r["args"]["id"].startswith("graphql:")]
    insist(result["sourceTreeSha256"] == tree_hash(revision), "wrong source")
    insist(result["invalidRequest"] == requests[0] and result["correctedRequest"] == requests[1], "request changed")
    insist(result["graphSize"] == result["finalGraphSize"] == 49, "graph changed")
    traffic = [{"method": method, "kind": kind, "bytes": len(fixture(f"response-{i}.bin"))}
               for method, kind, i in [("POST", "invalid", 4), ("GET", "probe", 5), ("POST", "introspection", 3)]]
    for key in ["invalid", "restarted"]:
        row = result[key]
        insist(row["status"] == "failed", "invalid request succeeded")
        insist(row["traffic"] == (traffic if arm == "baseline" else []), "unexpected invalid-request traffic")
        if arm == "candidate":
            insist(row["graphqlFailure"]["kind"] == "invalid-document" and
                    row["graphqlFailure"]["capability"] == requests[0]["id"], "lost failure classification")
    if arm == "baseline":
        insist(result["invalid"]["providerExperience"]["failed"] == 1, "baseline ledger mismatch")
    else:
        insist("providerExperience" not in result["invalid"], "local request error penalises provider")
    corrected = result["corrected"]
    insist(corrected["status"] == "completed" and corrected["output"] == json.loads(fixture("response-7.bin"))["data"]["entry"],
            "corrected output differs from original server response")
    insist(corrected["traffic"] == [{"method": "POST", "kind": "corrected", "bytes": len(fixture("response-7.bin"))}],
            "corrected traffic changed")
    insist(result["retainedBytes"] == (1950946 if arm == "baseline" else 2063266) and
            result["schemaBytes"] == (4 if arm == "baseline" else 112000), "retained size changed")
    elapsed = result["invalid"]["invalidMs"]
    insist(type(elapsed) in [int, float] and math.isfinite(elapsed) and elapsed > 0, "invalid timing")
    return elapsed


def check(folder):
    folder = Path(folder)
    protocol = json.loads((folder / "protocol.json").read_text())
    insist(set(protocol["revisions"]) == {"baseline", "candidate"} and protocol["revisions"]["baseline"] == BASELINE
            and protocol["revisions"]["candidate"] in CANDIDATES, "source freeze changed")
    insist(protocol["order"] == ORDER, "paired order changed")
    expected_files = {"protocol.json"}
    times = {"baseline": [], "candidate": []}
    for index, arm in enumerate(ORDER):
        stem = f"{index + 1}-{arm}"
        expected_files.update([stem + ".json", stem + ".process.json"])
        result = json.loads((folder / f"{stem}.json").read_text())
        process = json.loads((folder / f"{stem}.process.json").read_text())
        insist(process["exitCode"] == 0 and not process["stderr"], f"{stem}: process failed")
        elapsed = check_result(result, arm, protocol["revisions"][arm])
        insist(json.loads(process["stdout"]) == {"invalid": "failed", "invalidCalls": 3 if arm == "baseline" else 0,
                "restarted": "failed", "restartCalls": 3 if arm == "baseline" else 0, "corrected": "completed",
                "invalidMs": elapsed, "retainedBytes": result["retainedBytes"]}, "process/result mismatch")
        times[arm].append(elapsed)
    insist({p.name for p in folder.iterdir()} == expected_files, "unaccounted files or trials")
    return {"status": "pass", "trials": 6, "revisions": protocol["revisions"], "milliseconds": times,
            "medianMilliseconds": {arm: statistics.median(v) for arm, v in times.items()},
            "invalidRequestCalls": {"baseline": 3, "candidate": 0},
            "invalidResponseBytes": {"baseline": 648866, "candidate": 0},
            "scope": "exposed offline replay, not live latency, model economics or independent-author review"}


def check_public(folder):
    folder = Path(folder)
    result = json.loads((folder / "result.json").read_text())
    rows = list(map(json.loads, (folder / "network.jsonl").read_text().splitlines()))
    insist(result["freeze"] == FINAL and result["requests"] == len(rows) == 7, "public source/count mismatch")
    insist(result["endpoint"] == "https://countries.trevorblades.com/", "public origin changed")
    for index, row in enumerate(rows):
        raw = (folder / f"response-{index + 1}.bin").read_bytes()
        insist(row["id"] == index + 1 and row["bytes"] == len(raw) and row["url"] == result["endpoint"] and
                row["method"] == "POST" and row["status"] == (413 if index < 2 else 200), "public response mismatch")
        query = json.loads(row["body"])["query"]
        insist(query.lstrip().startswith("query ") and "mutation " not in query and "subscription " not in query,
                "non-read public request")
        insist(row["discovery"] is (index < 4), "public discovery accounting changed")
    insist(result["learnedAt"] == 4 and result["beforeInvalid"] == result["afterInvalid"] == 5 and
            result["afterWarm"] == 6 and result["restartedDiscovery"] == 0, "unexpected invalid/warm requests")
    for key, number in [("valid", 5), ("warm", 6)]:
        raw = json.loads((folder / f"response-{number}.bin").read_bytes())
        insist(result[key]["status"] == "completed" and result[key]["output"] == raw["data"][result["rootField"]],
                "public output differs from server data")
        insist(result[key]["verification"]["status"] == "unverified", "unsupported business verification claim")
    insist(result["invalid"]["status"] == "failed" and result["invalid"]["graphqlFailure"]["kind"] == "invalid-document",
            "public invalid document not refused")
    server = json.loads((folder / "response-7.bin").read_bytes())
    insist(result["server"] == server and server.get("errors") and "data" not in server, "server refusal absent")
    insist(result["wrong"] in json.loads(rows[6]["body"])["query"] and
            result["selection"] in json.loads(rows[4]["body"])["query"], "server evaluated another document")
    expected = {"result.json", "network.jsonl", "state.json"} | {f"response-{i}.bin" for i in range(1, 8)}
    insist({p.name for p in folder.iterdir()} == expected, "unaccounted public trial files")
    return {"status": "pass", "requests": 7, "responseBytes": sum(r["bytes"] for r in rows),
            "invalidRequests": 0, "warmDiscovery": 0, "rows": len(result["valid"]["output"]),
            "scope": "runtime-instance reuse and protocol outcome; not independent business-source verification"}


if __name__ == "__main__":
    print(json.dumps((check_public if len(sys.argv) > 2 and sys.argv[2] == "public" else check)(sys.argv[1]), indent=2))

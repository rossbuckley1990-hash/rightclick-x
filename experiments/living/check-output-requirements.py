"""Separate offline accounting check; same author, not independent-author review."""
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
BASELINE = "d4eef5ffc6ad94a87ac70a2116c2bff0e622184d"
CANDIDATES = {"90e453a85ac743740d67dab236250ebc8b748bde", "be84f20f9282a79c86de7b285e465c36739513e7"}
ORDER = ["baseline", "candidate", "candidate", "baseline", "baseline", "candidate"]


def insist(ok, message):
    if not ok:
        raise ValueError(message)


@lru_cache(maxsize=2)
def tree_hash(revision):
    data = subprocess.check_output(["git", "archive", revision, "src", "package.json"], cwd=ROOT)
    digest = hashlib.sha256()
    with tarfile.open(fileobj=io.BytesIO(data)) as archive:
        for entry in sorted((e for e in archive.getmembers() if e.isfile()), key=lambda e: e.name):
            digest.update(entry.name.encode() + b"\0")
            digest.update(archive.extractfile(entry).read())
            digest.update(b"\0")
    return digest.hexdigest()


def check(folder):
    folder = Path(folder)
    protocol = json.loads((folder / "protocol.json").read_text())
    insist(set(protocol["revisions"]) == {"baseline", "candidate"}
            and protocol["revisions"]["baseline"] == BASELINE
            and protocol["revisions"]["candidate"] in CANDIDATES, "source freeze changed")
    insist(protocol["order"] == ORDER, "paired order changed")
    fixture = "docs/adaptive/evidence/reuse-comparison-attempt3/warm2-d"
    state = subprocess.check_output(["git", "show", f"{BASELINE}:{fixture}/before.json"], cwd=ROOT)
    transcript = subprocess.check_output(["git", "show", f"{BASELINE}:{fixture}/mcp.jsonl"], cwd=ROOT, text=True)
    expected_request = next(row["args"] for row in map(json.loads, transcript.splitlines())
                            if row["tool"] == "context_compose")
    expected_files = {"protocol.json"}
    times = {"baseline": [], "candidate": []}
    rss = {"baseline": [], "candidate": []}
    for index, arm in enumerate(ORDER):
        stem = f"{index + 1}-{arm}"
        expected_files.update([stem + ".json", stem + ".process.json"])
        result = json.loads((folder / f"{stem}.json").read_text())
        process = json.loads((folder / f"{stem}.process.json").read_text())
        insist(process["exitCode"] == 0 and not process["stderr"], f"{stem}: process failed")
        insist(result["sourceTreeSha256"] == tree_hash(protocol["revisions"][arm]), f"{stem}: wrong source")
        insist(result["stateSha256"] == hashlib.sha256(state).hexdigest(), f"{stem}: wrong state")
        insist(result["request"] == expected_request, f"{stem}: request changed")
        insist(result["requests"] == 0 and result["executed"] is False and result["published"] is False,
                f"{stem}: dispatched or published")
        insist(result["before"] == result["after"] == 69, f"{stem}: graph changed")
        insist(result["outcome"]["status"] == "unavailable" and result["outcome"]["require"] == expected_request["require"]
                and result["outcome"]["missing"] == expected_request["require"], f"{stem}: refusal changed")
        insist(result["plans"] == (5 if arm == "baseline" else 0), f"{stem}: candidate search changed")
        if arm == "candidate":
            insist("current graph" in result["outcome"]["reason"] and "through" in result["outcome"]["reason"],
                    f"{stem}: diagnostic missing")
        for field in ["milliseconds", "rss"]:
            value = result[field]
            insist(isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value > 0,
                    f"{stem}: invalid {field}")
        insist(json.loads(process["stdout"]) == {"milliseconds": result["milliseconds"], "requests": 0,
                "outcome": "unavailable", "plans": result["plans"]}, f"{stem}: process/result mismatch")
        times[arm].append(result["milliseconds"])
        rss[arm].append(result["rss"])
    insist({p.name for p in folder.iterdir()} == expected_files, "unaccounted files or trials")
    return {"status": "pass", "trials": 6, "revisions": protocol["revisions"],
            "milliseconds": times, "medianMilliseconds": {arm: statistics.median(values) for arm, values in times.items()},
            "rssBytes": rss, "networkCalls": 0, "executions": 0, "publications": 0,
            "scope": "one exposed offline request; no model economic, peak-memory or independent-author claim"}


if __name__ == "__main__":
    print(json.dumps(check(sys.argv[1]), indent=2))

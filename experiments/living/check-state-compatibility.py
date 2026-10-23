"""Separate result interpretation; no runtime/harness imports or new provider calls."""
import copy
import hashlib
import json
from pathlib import Path
import sys

OLD = ["d4c2ac74", "6fa0da73"]


def require(ok, message):
    if not ok:
        raise ValueError(message)


def verify(states, report):
    rows = {(r["reader"], r["state"]): r for r in report["results"]}
    require(len(rows) == len(report["results"]) == 9, "reader matrix incomplete")
    require(set(rows) == {(r, s) for r in ["current", *OLD] for s in states}, "matrix axes changed")
    for row in rows.values():
        expected = hashlib.sha256(states[row["state"]].encode()).hexdigest()
        require(row["beforeHash"] == expected, "input bytes not bound to observation")
        require(row["bytesPreserved"] == (row["beforeHash"] == row["afterHash"]), "preservation observation disagrees")
    envelope = json.loads(states["currentEncoding"])
    require(envelope["format"] == "rightclick-x/runtime-state@2", "wrong envelope")
    require(envelope["version"] == 1 and envelope["reflections"] == {"requires": envelope["format"]}, "legacy refusal guard lost")
    payload = envelope["state"]
    require(payload["version"] == 2 and len(payload["requirements"]) == 3, "requirements lost")
    cap = next(c for r in payload["reflections"] for c in r["capabilities"] if c["id"] == "composite:scoped")
    require(cap["invoke"]["origins"] == [] and len(cap["invoke"]["steps"]) == 1, "retained restriction lost")
    for reader in OLD:
        guarded = rows[reader, "currentEncoding"]
        require(guarded["created"] is False and guarded["calls"] == 0 and guarded["bytesPreserved"] is True, "legacy encoding executed or overwritten")
        require("reflections is not iterable" in guarded["error"], "unexpected legacy refusal")
        naive = rows[reader, "naiveVersionBump"]
        require(naive["created"] is True and naive["calls"] == 0 and naive["bytesPreserved"] is False, "naive version failure no longer visible")
        require("unknown capability" in naive["runError"], "naive version loaded a capability")
    for name in ["legacy", "currentEncoding"]:
        current = rows["current", name]
        require(current["created"] is True and current["calls"] == 0 and current["run"]["status"] == "failed", "current restriction not enforced")
    future = rows["current", "naiveVersionBump"]
    require(future["created"] is False and future["calls"] == 0 and future["bytesPreserved"] is True, "unsupported requirements silently reset")
    legacy = rows["d4c2ac74", "legacy"]
    require(legacy["calls"] == 1 and legacy["run"]["status"] == "completed", "original bypass control missing")


root = Path(sys.argv[1])
states = {name: (root / (name + ".json")).read_text() for name in ["legacy", "naiveVersionBump", "currentEncoding"]}
report = json.loads((root / "results.json").read_text())
verify(states, report)
rejected = []
for mode in ["guard", "restriction", "executed", "overwritten", "missing-reader"]:
    altered = dict(states); changed = copy.deepcopy(report)
    if mode in ["guard", "restriction"]:
        data = json.loads(altered["currentEncoding"])
        if mode == "guard":
            data["reflections"] = []
        else:
            next(c for r in data["state"]["reflections"] for c in r["capabilities"] if c["id"] == "composite:scoped")["invoke"]["origins"] = ["https://controlled.invalid"]
        altered["currentEncoding"] = json.dumps(data)
        # Rebind hashes so the semantic check, not just file integrity, must reject.
        for row in changed["results"]:
            if row["state"] == "currentEncoding":
                row["beforeHash"] = hashlib.sha256(altered["currentEncoding"].encode()).hexdigest()
                if row["bytesPreserved"]:
                    row["afterHash"] = row["beforeHash"]
    elif mode == "missing-reader":
        changed["results"].pop()
    else:
        row = next(r for r in changed["results"] if r["reader"] == OLD[0] and r["state"] == "currentEncoding")
        if mode == "executed":
            row["calls"] = 1
        else:
            row["afterHash"] = "0" * 64
            row["bytesPreserved"] = False
    try:
        verify(altered, changed)
    except (ValueError, KeyError, StopIteration):
        rejected.append(mode)
    else:
        raise ValueError("accepted corrupted evidence: " + mode)
print(json.dumps({"status": "PASS", "readerStatePairs": 9, "guardedLegacyRefusals": 2,
    "naiveLegacyOverwritesPreservedAsFailures": 2, "corruptionsRejected": rejected,
    "scope": "same author, separate result interpretation; known frozen readers and controlled mock provider only"}, indent=2))

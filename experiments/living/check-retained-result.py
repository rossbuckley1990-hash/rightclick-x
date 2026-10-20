"""Independent accounting implementation, same author; no independent-author claim."""
from functools import lru_cache
import copy
import hashlib
import io
import json
import math
from pathlib import Path
import subprocess
import sys
import tarfile

ROOT = Path(__file__).resolve().parents[2]
BASE = "d95f1bc1d289c00ff1b0613447ed74151265a058"
INITIAL = "be769c3e0a21488017341b8e8d5684da4ee0a478"
FINAL = "64bbb1a24ab5bf8adb449d8371981e426752de58"
ORDER = [["warm1-d", "baseline"], ["warm1-d", "candidate"], ["warm2-d", "candidate"], ["warm2-d", "baseline"]]


def insist(ok, reason):
    if not ok:
        raise ValueError(reason)


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


@lru_cache(maxsize=3)
def tree_hash(revision):
    data = subprocess.check_output(["git", "archive", revision, "src", "package.json"], cwd=ROOT)
    digest = hashlib.sha256()
    with tarfile.open(fileobj=io.BytesIO(data)) as archive:
        for entry in sorted((e for e in archive.getmembers() if e.isfile()), key=lambda e: e.name):
            digest.update(entry.name.encode() + b"\0")
            digest.update(archive.extractfile(entry).read())
            digest.update(b"\0")
    return digest.hexdigest()


@lru_cache(maxsize=16)
def fixture(phase, name):
    return subprocess.check_output(["git", "show", f"{BASE}:docs/adaptive/evidence/reuse-comparison-attempt3/{phase}/{name}"], cwd=ROOT)


def contract_signature(cap):
    value = [[ [p["name"], p["type"], p.get("required")] for p in cap["inputs"] ],
             [[p["name"], p["type"]] for p in cap["outputs"] if not p.get("observed")], cap["invoke"]]
    raw = compact(value).encode("utf-16-le", errors="surrogatepass")
    h = 0x811c9dc5
    for offset in range(0, len(raw), 2):
        h = ((h ^ int.from_bytes(raw[offset:offset + 2], "little")) * 0x01000193) & 0xffffffff
    return f"{h:08x}"


def declaration(saved, state):
    caps = {c["id"]: c for ref in state["reflections"] for c in ref["capabilities"]}
    cap, path = caps[saved["root"]["capability"]], saved["root"]["path"]
    refs = []
    while True:
        refs.append({"capability": cap["id"], "signature": contract_signature(cap)})
        if cap["invoke"]["kind"] != "composite":
            break
        parts = cap["invoke"]["result"].split(".")
        path = ".".join(parts[1:] + ([path] if path else []))
        cap = caps[cap["invoke"]["steps"][int(parts[0])]["capability"]]
    seen, fields, chars, truncated = set(), [], 0, False
    entries = cap.get("fields", []) + [{"path": p["name"], "selected": True} for p in cap["outputs"] if p["name"] and not p.get("observed")]
    for field in entries:
        absolute = field["path"].replace("[]", "")
        if path and not absolute.startswith(path + "."):
            continue
        relative = absolute[len(path) + 1:] if path else absolute
        if not relative or relative in seen:
            continue
        seen.add(relative)
        item = {"path": relative, **({"selected": field["selected"]} if "selected" in field else {})}
        size = len(compact(item).encode("utf-16-le")) // 2
        if len(fields) >= 64 or chars + size > 4096:
            truncated = True
            continue
        fields.append(item)
        chars += size
    return {"type": "json", "root": saved["root"], "references": refs, "fields": fields, "truncated": truncated}


def old_disclosure(value):
    value = copy.deepcopy(value)
    value.pop("reuse", None)
    semantics = value["contract"]["outputSemantics"]
    semantics.pop("lastResult", None)
    semantics.pop("checkPaths", None)
    return value


def check(folder):
    folder = Path(folder)
    protocol = json.loads((folder / "protocol.json").read_text())
    insist(protocol["order"] == ORDER and protocol["revisions"] == {"baseline": BASE, "candidate": protocol["revisions"].get("candidate")}
            and protocol["revisions"]["candidate"] in [INITIAL, FINAL], "protocol/source changed")
    expected_files, results = {"protocol.json"}, {}
    for index, (phase, arm) in enumerate(ORDER):
        stem = f"{index + 1}-{arm}-{phase}"
        expected_files.update([stem + ".json", stem + ".process.json"])
        data = json.loads((folder / f"{stem}.json").read_text())
        process = json.loads((folder / f"{stem}.process.json").read_text())
        insist(process["exitCode"] == 0 and not process["stderr"], "process failed")
        state_raw = fixture(phase, "before.json")
        state = json.loads(state_raw)
        request = next(r["args"] for r in map(json.loads, fixture(phase, "mcp.jsonl").splitlines()) if r["tool"] == "context_run")
        insist(data["sourceTreeSha256"] == tree_hash(protocol["revisions"][arm]) and data["stateSha256"] == hashlib.sha256(state_raw).hexdigest(), "source/state mismatch")
        insist(data["phase"] == phase and data["request"] == request, "input changed")
        expected_calls = [{k: r[k] for k in ["url", "method", "body"] if k in r}
                          for r in list(map(json.loads, fixture(phase, "network.jsonl").splitlines()))[:2]]
        insist(data["calls"] == expected_calls and data["callsBeforeRestart"] == 2, "requests or rediscovery changed")
        insist(data["graphBefore"] == data["graphAfter"] == 69, "graph grew")
        insist(data["run"]["status"] == "completed" and data["run"]["verification"]["status"] == "checked", "outcome/grade changed")
        output = json.loads(fixture(phase, "response-2.bin"))
        insist(data["run"]["output"] == output, "output differs from original provider response")
        projection = {"message." + k: output["message"][k] for k in ["DOI", "title", "publisher"]}
        insist(data["projected"]["output"] == projection and data["projected"]["receipt"] == data["run"]["receipt"], "projection altered output/receipt")
        insist(data["goalsBefore"] == state["published"] and len(data["goalsAfter"]) == len(state["published"]) == 1, "publication changed")
        before_goal, after_goal = data["goalsBefore"][0], data["goalsAfter"][0]
        mutable = {"calls", "lastPipeline", "providers", "lastResult"}
        insist({k: v for k, v in before_goal.items() if k not in mutable} == {k: v for k, v in after_goal.items() if k not in mutable}, "saved definition changed")
        insist(after_goal["calls"] == before_goal["calls"] + 1, "extra goal execution")
        insist(data["after"] == data["restarted"], "restart lost guidance")
        if arm == "candidate":
            insist(data["before"]["contract"]["outputSemantics"]["lastResult"]["status"] == "not-recorded", "legacy evidence invented")
            reuse = data["after"]["reuse"]
            insist(reuse["id"] == request["id"] and reuse["storage"] == "store-configured" and
                    reuse["invoke"] == {"tool": "context_run", "args": {"id": request["id"]}}, "reuse guidance changed")
            insist(reuse["restrictions"] == {k: before_goal[k] for k in ["origins", "risks", "through", "require", "maxSteps"] if k in before_goal}, "saved restrictions missing")
            saved = after_goal["lastResult"]
            insist(saved == declaration(saved, state), "result declarations differ from retained provider contracts")
            exposed = data["after"]["contract"]["outputSemantics"]["lastResult"]
            expected_status = "matches-retained-result-subset" if protocol["revisions"]["candidate"] == FINAL else "matches-current-result-declaration"
            insist(saved["truncated"] and exposed["status"] == expected_status and exposed["fields"] == saved["fields"], "bounded result scope changed")
            insist("reuse" in data["run"], "run lost retention guidance")
        else:
            insist("reuse" not in data["before"] and "lastResult" not in after_goal, "baseline changed")
        insist(type(data["milliseconds"]) in [int, float] and math.isfinite(data["milliseconds"]) and data["milliseconds"] > 0, "invalid timing")
        for key in ["before", "after", "run", "projected"]:
            insist(data["bytes"][key] == len(compact(data[key]).encode()), "byte count mismatch")
        insist(json.loads(process["stdout"]) == {"phase": phase, "status": "completed", "calls": 2,
                "milliseconds": data["milliseconds"], "bytes": data["bytes"]}, "process/result mismatch")
        results[(phase, arm)] = data
    insist({p.name for p in folder.iterdir()} == expected_files, "unaccounted attempt/files")
    for phase in ["warm1-d", "warm2-d"]:
        baseline, candidate = results[(phase, "baseline")], results[(phase, "candidate")]
        for key in ["before", "after"]:
            insist(old_disclosure(baseline[key]) == old_disclosure(candidate[key]), "existing contract or authority disclosure changed")
    return {"status": "pass", "trials": 4, "callsPerTrial": 2, "rediscovery": 0, "newPublication": 0,
            "measurements": [{"phase": phase, "arm": arm, "milliseconds": data["milliseconds"], "bytes": data["bytes"]}
                             for (phase, arm), data in results.items()],
            "scope": "same-author offline check; larger disclosure, no model-economic or independent-author claim"}


if __name__ == "__main__":
    print(json.dumps(check(sys.argv[1]), indent=2))

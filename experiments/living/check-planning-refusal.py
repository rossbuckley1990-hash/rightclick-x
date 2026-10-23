"""Separate, same-author offline comparison checker; no independent-author claim."""
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
START = "e197073475527c8eb1a16ac6e6cdff1284a948cb"
FILES = ["src/runtime.ts", "src/core/planner.ts", "src/interface/graphql-server.ts"]


def sha(data):
    return hashlib.sha256(data).hexdigest()


def check(baseline, candidate):
    expected_state = sha((ROOT / "docs/adaptive/evidence/living-public/attempt3/state.json").read_bytes())
    for label, data in [("baseline", baseline), ("candidate", candidate)]:
        assert data["stateSha256"] == expected_state, "retained input changed"
        assert data["transport"] == "counted offline mock only"
        assert len(data["samples"]) == 10
        assert set(data["sourceHashes"]) == set(FILES)
        for name, digest in data["sourceHashes"].items():
            source = (ROOT / name).read_bytes() if label == "candidate" else subprocess.check_output(
                ["git", "show", f"{START}:{name}"], cwd=ROOT)
            assert digest == sha(source), "source changed"
        for row in data["samples"]:
            assert row["calls"] == 0, "hidden transport"
            assert row["status"] == "failed", "false successful result"
            assert row["durationMs"] >= 0
            if label == "candidate":
                refusal = row["planningRefusal"]
                assert refusal and refusal["scope"] == "local-runtime-policy", "missing diagnosis"
                assert refusal["independentAuthority"] == "not-assessed", "forged authority"
                assert refusal["coverage"] == "bounded-candidate-search"
                assert not refusal["runs"]
                assert refusal["blocked"] and all(b["reasons"] for b in refusal["blocked"])
                assert row["ledgerUnchanged"], "policy refusal degraded experience"
            else:
                assert row["planningRefusal"] is None
                assert not row["ledgerUnchanged"], "original regression is absent"
        scopes = {s["scope"]: s for s in data["scopes"]}
        assert set(scopes) == {"omitted", "empty-risks", "empty-origins"}
        assert scopes["omitted"]["dispatches"] == 1
        assert scopes["omitted"]["execution"] == "completed"
        assert scopes["empty-origins"]["dispatches"] == 0
        if label == "baseline":
            assert scopes["empty-risks"]["dispatches"] == 1, "original mock dispatch regression absent"
        else:
            for name in ["empty-risks", "empty-origins"]:
                assert scopes[name]["dispatches"] == 0, "unauthorized mock dispatch"
                assert scopes[name]["plans"] == 0 and scopes[name]["execution"] is None
                assert scopes[name]["planningRefusal"]
    return True


baseline = json.loads(Path(sys.argv[1]).read_text())
candidate = json.loads(Path(sys.argv[2]).read_text())
check(baseline, candidate)
rejected = []
for label in ["dispatch", "transport", "authority", "experience", "diagnosis", "source"]:
    corrupt = copy.deepcopy(candidate)
    if label == "dispatch":
        corrupt["scopes"][1]["dispatches"] = 1
    elif label == "transport":
        corrupt["samples"][0]["calls"] = 1
    elif label == "authority":
        corrupt["samples"][0]["planningRefusal"]["independentAuthority"] = "granted"
    elif label == "experience":
        corrupt["samples"][0]["ledgerUnchanged"] = False
    elif label == "diagnosis":
        corrupt["samples"][0]["planningRefusal"] = None
    else:
        corrupt["sourceHashes"][FILES[0]] = "0" * 64
    try:
        check(baseline, corrupt)
    except AssertionError:
        rejected.append(label)
    else:
        raise AssertionError(f"checker accepted corruption: {label}")
print(json.dumps({"status": "PASS", "samplesPerRevision": 10, "scopesPerRevision": 3,
    "diagnosedBaseline": 0, "diagnosedCandidate": 10, "providerCalls": 0,
    "emptyRiskMockDispatches": {"baseline": 1, "candidate": 0}, "corruptionsRejected": rejected,
    "authorIndependence": False}, indent=2))

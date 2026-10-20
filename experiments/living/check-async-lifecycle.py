"""Separate resource-state/transport/receipt checker; same author, not an independent holdout."""
import hashlib
import json
from pathlib import Path
import sys

root = Path(sys.argv[1])
read = lambda name: json.loads((root / f"{name}.json").read_text())
resource = read("resource-state")
cold, reuse = read("cold"), read("reuse")
assert cold["pid"] != reuse["pid"], "reuse must be a different process"
assert cold["outcome"]["executed"]["status"] == reuse["outcome"]["status"] == "completed"
assert cold["outcome"]["executed"]["verification"]["status"] == reuse["outcome"]["verification"]["status"] == "checked"
assert len(resource["jobs"]) == 2, "one original effect per invocation"
inputs = ["first input", "a different input"]
for index, (stage, worker, original) in enumerate(zip(["first", "second"], [cold, reuse], inputs)):
    transport = read(f"{stage}-transport")
    assert transport["code"] == 0
    events = transport["events"]
    submits = [e for e in events if e["path"] == "/render"]
    assert len(submits) == 1 and submits[0]["body"] == {"text": original}
    expected = "RENDERED: " + original.upper()
    job = resource["jobs"][index][1]
    assert job == {"text": expected, "polls": 2}, "independent resource state differs"
    counts = [e for e in events if e["path"] == "/count"]
    assert len(counts) == 1 and counts[0]["body"] == {"text": expected}, "intermediate binding is wrong"
    result = worker["outcome"] if index else worker["outcome"]["executed"]
    assert result["output"] == len(expected), "business result differs from resource state"
    if index:
        assert all(e["path"] not in ["/catalog", "/render.json", "/count.json"] for e in events), "fresh process rediscovered"
    else:
        assert {"/catalog", "/render.json", "/count.json"} <= {e["path"] for e in events}
    receipts = worker["receipts"]
    prev = "0" * 64
    for receipt in receipts:
        assert receipt["prev"] == prev
        body = {k: v for k, v in receipt.items() if k != "hash"}
        encoded = json.dumps(body, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
        assert hashlib.sha256(encoded).hexdigest() == receipt["hash"], "receipt hash mismatch"
        prev = receipt["hash"]
    continuations = [r["httpContinuation"] for r in receipts if "httpContinuation" in r]
    assert len(continuations) == index + 1
    for continuation in continuations:
        assert continuation["stopped"] == "result"
        assert [r["status"] for r in continuation["requests"]] == [202, 303, 200]
print(json.dumps({"pass": True, "cold_and_reused_results": 2, "original_effects": 2,
    "replayed_effects": 0, "fresh_process_discovery_requests": 0, "bound_receipt_chains": 2,
    "scope": "controlled local HTTP fixtures; separate checker implementation, same author"}, indent=2))

if "--negative-controls" in sys.argv[2:]:
    import shutil
    import subprocess
    import tempfile
    mutations = {
        "wrong-result": ("reuse", lambda d: d["outcome"].update(output=-1)),
        "wrong-intermediate": ("second-transport", lambda d: next(e for e in d["events"] if e["path"] == "/count")["body"].update(text="wrong")),
        "duplicate-effect": ("second-transport", lambda d: d["events"].append(next(e for e in d["events"] if e["path"] == "/render"))),
        "hidden-rediscovery": ("second-transport", lambda d: d["events"].append({"method": "GET", "path": "/render.json"})),
        "same-process": ("reuse", lambda d: d.update(pid=cold["pid"])),
        "altered-receipt": ("reuse", lambda d: d["receipts"][0].update(status="failed")),
    }
    controls = {}
    for name, (file, mutate) in mutations.items():
        with tempfile.TemporaryDirectory(prefix="rcx-async-control-") as tmp:
            target = Path(tmp) / "evidence"
            shutil.copytree(root, target)
            path = target / f"{file}.json"
            data = json.loads(path.read_text())
            mutate(data)
            path.write_text(json.dumps(data))
            result = subprocess.run([sys.executable, __file__, str(target)], capture_output=True, text=True)
            assert result.returncode != 0 and "AssertionError" in result.stderr, name
            controls[name] = "rejected"
    print(json.dumps({"negativeControls": controls}, indent=2))

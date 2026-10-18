"""Check packaged CLI evidence without importing RightClick. Same author, separate implementation."""
from collections import Counter
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tarfile

REPO = Path(__file__).resolve().parents[2]
encode = lambda value: json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
digest = lambda data: hashlib.sha256(data).hexdigest()


def check(root, records=None):
    read = lambda name: json.loads((root / name).read_text())
    manifest, result, discovered = read("manifest.json"), read("result.json"), read("discovered.json")
    records = records if records is not None else [json.loads(line) for line in (root / "commands.jsonl").read_text().splitlines()]
    counts = Counter(r["label"] for r in records)
    required = ["build", "pack", "install", "investigate", "catalogue", "file-input", "inline-fresh-reuse", "stdin-fresh-reuse", "named-file-0", "named-file-1", "operator-refusal", "thirteen-tools", "uninstall"]
    assert all(counts[label] == 1 for label in required)
    assert all(r["status"] == (1 if r["label"] == "operator-refusal" else 0) and r["signal"] is None for r in records)
    rows = {r["label"]: r for r in records}
    pack = json.loads(rows["pack"]["stdout"])[0]
    artifact = root / pack["filename"]
    assert digest(artifact.read_bytes()) == result["packageSha256"]
    assert artifact.stat().st_size == result["packageBytes"] == pack["size"]
    with tarfile.open(artifact) as archive:
        for path, sha in manifest["sourceHashes"].items():
            frozen = subprocess.check_output(["git", "show", manifest["commit"] + ":" + path], cwd=REPO)
            assert digest(frozen) == sha
            assert archive.extractfile("package/" + path).read() == frozen
    harness = subprocess.check_output(["git", "show", manifest["harnessCommit"] + ":experiments/north-star/cli-input-package.mjs"], cwd=REPO)
    assert digest(harness) == manifest["harnessSha256"]
    initial, after = read("initial-state.json"), read("after-state.json")
    assert initial["reflections"] == after["reflections"]
    assert len(after["receipts"]) == len(initial["receipts"]) + 5
    cli, sort = discovered["selected"]["invoke"], discovered["sort"]["invoke"]
    for label in ["file-input", "inline-fresh-reuse", "stdin-fresh-reuse", "named-file-0", "named-file-1"]:
        row = rows[label]
        if label == "file-input":
            args = read("file-arguments.json")
        elif label == "inline-fresh-reuse":
            args = json.loads(row["args"][row["args"].index("--args") + 1])
        else:
            args = json.loads(row["input"])
        run = json.loads(row["stdout"])
        assert run["status"] == "completed" and run["verification"]["status"] == "unverified"
        assert run["receipt"]["inputDigest"] == digest(encode(args))
        assert run["receipt"]["outputDigest"] == digest(encode(run["output"]))
        if label.startswith("named-file-"):
            assert args[sort["options"]["port"]] == ["-r"]
            files, operands = args[sort["filesPort"]], args[sort["operandsPort"]]
            expected = "\n".join(sorted([line for name in operands for line in files[name].splitlines()], reverse=True)) + "\n"
            assert run["output"] == expected
        else:
            assert args[cli["options"]["port"]] == ["-f", "json", "-t", "json-pretty"]
            assert json.loads(run["output"]) == json.loads(args[cli["stdin"]])
            assert "\n   " in run["output"]
    refusal = json.loads(rows["operator-refusal"]["stdout"])
    assert refusal["status"] == "failed" and "execution policy" in refusal["error"] and "output" not in refusal
    tools = json.loads(rows["thirteen-tools"]["stdout"])["result"]["tools"]
    assert len(tools) == len({t["name"] for t in tools}) == 13
    return {"correctOutputs": 5, "retainedReflectionUnchanged": True, "packageSourcesVerified": len(manifest["sourceHashes"]), "commands": len(records)}


root = Path(sys.argv[1])
verified = check(root)
original = [json.loads(line) for line in (root / "commands.jsonl").read_text().splitlines()]
controls = {}
for name in ["wrong-output-with-updated-digest", "changed-input", "hidden-invocation", "false-verified-grade"]:
    records = copy.deepcopy(original)
    row = next(r for r in records if r["label"] == "inline-fresh-reuse")
    run = json.loads(row["stdout"])
    if name == "wrong-output-with-updated-digest":
        run["output"] = '{"wrong":true}'
        run["receipt"]["outputDigest"] = digest(encode(run["output"]))
        row["stdout"] = json.dumps(run)
    elif name == "changed-input":
        index = row["args"].index("--args") + 1
        row["args"][index] = '{"changed":"input"}'
    elif name == "hidden-invocation":
        records = [r for r in records if r["label"] != "named-file-1"]
    else:
        run["verification"]["status"] = "verified"
        row["stdout"] = json.dumps(run)
    try:
        check(root, records)
    except AssertionError:
        controls[name] = "rejected"
    else:
        raise AssertionError("corruption accepted: " + name)
print(json.dumps({"verdict": "PASS", "checked": verified, "controls": controls,
                  "scope": "same-author separate Python checker; not independent-author validation, native-call instrumentation or comparative economics"}, indent=2))

"""Raw development evidence checker, separate implementation; NOT independent-author review."""
import hashlib
import copy
import json
import pathlib
import subprocess
import sys
import tempfile

root = pathlib.Path(__file__).resolve().parents[2]
manifest_path = "docs/north-star/evidence/holdout-ns-freeze-1.json"
manifest = json.loads((root / manifest_path).read_text())
targets = {"xsubpp5.34", "autom4te", "lzdiff", "exiftool"}
tasks = {t["id"]: t for p in manifest["programs"] if p["name"] in targets for t in p["tasks"] if t["kind"] == "feasible"}


def normalized(run):
    return run["stdout"].replace(run["workDir"], "<work>").replace(run["workDir"].removeprefix("/private"), "<work>")


def check(path, after):
    report = json.loads(path.read_text())
    assert not report["sourceDirty"], "source must be frozen and clean"
    for name, digest in report["sourceHashes"].items():
        source = subprocess.check_output(["git", "show", f'{report["sourceCommit"]}:{name}'], cwd=root)
        assert hashlib.sha256(source).hexdigest() == digest, name
    seen, matched = set(), []
    for program in report["programs"]:
        assert program["name"] in targets
        for obs in program["observations"]:
            task = obs["task"]
            ident = task["id"]
            assert ident not in seen and task == tasks[ident], ident
            seen.add(ident)
            direct = obs["direct"]
            assert direct["code"] in (0, 1) and not direct["timedOut"] and not direct["truncated"], ident
            assert all(s in direct["stdout"] for s in task.get("expect", [])), ident
            assert not obs.get("mappingError"), ident
            response = obs["response"]
            assert response["verification"]["status"] != "verified", "no independent runtime witness was supplied"
            if program["name"] == "exiftool":
                assert response["status"] == "failed" and "not one this program documents" in response["error"], ident
                assert obs["wires"] == [], ident
                continue
            assert len(obs["wires"]) == 1, ident
            wire = obs["wires"][0]
            assert wire["program"] == program["path"]
            assert wire["options"]["files"] == task["input"].get("files", {}), ident
            assert wire["options"]["stdin"] == task["input"].get("stdin", ""), ident
            if not after and ident == "xsubpp5.34#4":
                assert wire["args"] == task["reference"]["argv"] + ["mytypemap"], ident
                assert response["status"] == "failed" and wire["result"]["code"] == 255, ident
                continue
            assert wire["args"] == task["reference"]["argv"], ident
            result = wire["result"]
            assert response["status"] == "completed", ident
            assert not result["timedOut"] and not result["truncated"], ident
            assert result["code"] == direct["code"], ident
            assert response["output"] == result["stdout"], ident
            assert normalized(result) == normalized(direct), ident
            matched.append(ident)
    assert seen == set(tasks) and len(seen) == 16
    assert len(matched) == (12 if after else 11)
    return {"path": str(path), "commit": report["sourceCommit"], "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "tasks": len(seen), "exactDirectMatches": len(matched), "matched": matched, "unsupportedDynamicSelectors": 4}


if __name__ == "__main__":
    assert len(sys.argv) == 3, "provide before.json and after.json"
    before, after = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
    result = {"scope": "exposed oracle-guided development diagnostic only", "before": check(before, False), "after": check(after, True)}
    controls = []
    with tempfile.TemporaryDirectory(prefix="rcx-cli-files-check-") as stage:
        for name in ("duplicated-operand", "altered-input"):
            altered = copy.deepcopy(json.loads(after.read_text()))
            obs = next(o for p in altered["programs"] for o in p["observations"] if o["task"]["id"] == "xsubpp5.34#4")
            if name == "duplicated-operand":
                obs["wires"][0]["args"].append("mytypemap")
            else:
                obs["wires"][0]["options"]["files"]["mytypemap"] = "wrong mapping\n"
            path = pathlib.Path(stage) / (name + ".json")
            path.write_text(json.dumps(altered))
            try:
                check(path, True)
            except AssertionError as error:
                controls.append({"case": name, "rejected": True, "reason": str(error)})
            else:
                raise AssertionError("checker accepted " + name)
    result["negativeControls"] = controls
    print(json.dumps(result, indent=2))

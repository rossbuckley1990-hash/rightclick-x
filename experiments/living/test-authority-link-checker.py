"""Corrupt preserved combined evidence; never change the original trial."""
import importlib.util
import json
from pathlib import Path
import shutil
import sys
import tempfile

spec = importlib.util.spec_from_file_location("checker", Path(__file__).with_name("check-authority-links.py"))
checker = importlib.util.module_from_spec(spec); spec.loader.exec_module(checker)
source = Path(sys.argv[1]).resolve()
controls = []
with tempfile.TemporaryDirectory(prefix="rcx-link-checker-") as temp:
    root = Path(temp) / "trial"; shutil.copytree(source, root)
    names = ["adaptation-authority.json", "boundary/issuer/transport-links.jsonl", "boundary/attestations.jsonl", "session.jsonl"]
    originals = {name: (root / name).read_bytes() for name in names}
    checker.check(root)
    for case in ["missing-link", "wrong-run", "wrong-request", "false-current-authority", "direct-probe-linked",
                 "wire-header", "native-attempt", "signature", "duplicate-log"]:
        for name, data in originals.items(): (root / name).write_bytes(data)
        feed = json.loads(originals[names[0]])
        logs = [json.loads(s) for s in originals[names[1]].splitlines()]
        native = [json.loads(s) for s in originals[names[2]].splitlines()]
        linked = next(r for r in feed["records"] if "runtimeLink" in r)
        if case == "missing-link": del linked["runtimeLink"]
        elif case == "wrong-run": linked["runtimeLink"]["runId"] = "run_other"
        elif case == "wrong-request": linked["runtimeLink"]["requestId"] = "00000000-0000-4000-8000-000000000000"
        elif case == "false-current-authority": feed["currentAuthority"] = "authorised"
        elif case == "direct-probe-linked": next(r for r in feed["records"] if r["outcome"] == "refused")["runtimeLink"] = linked["runtimeLink"]
        elif case == "wire-header": logs[0]["wire"]["headers"]["accept"] = "changed"
        elif case == "native-attempt": logs[0]["artifacts"][0]["nativeRequestId"] = "wrong"
        elif case == "signature": native[0]["signature"]["value"] = "A" * len(native[0]["signature"]["value"])
        elif case == "duplicate-log": logs.append(logs[0])
        (root / names[0]).write_text(json.dumps(feed))
        (root / names[1]).write_text("".join(json.dumps(r) + "\n" for r in logs))
        (root / names[2]).write_text("".join(json.dumps(r) + "\n" for r in native))
        try:
            checker.check(root)
        except Exception as error:
            controls.append({"case": case, "rejected": True, "errorType": type(error).__name__})
        else:
            raise AssertionError("checker accepted corruption: " + case)
print(json.dumps({"status": "PASS", "controls": controls, "scope": "same-author exposed evidence corruption controls"}, indent=2))

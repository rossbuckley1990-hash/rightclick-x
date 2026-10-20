"""Four fresh-process replays of two retained warm sessions; immutable source."""
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile

baseline, candidate, destination = sys.argv[1:]
out = Path(destination).resolve()
out.mkdir(parents=True, exist_ok=False)
revisions = {arm: subprocess.check_output(["git", "rev-parse", f"{ref}^{{commit}}"], text=True).strip()
             for arm, ref in [("baseline", baseline), ("candidate", candidate)]}
script = "experiments/living/replay-retained-result.ts"
if Path(script).read_bytes() != subprocess.check_output(["git", "show", f"{revisions['candidate']}:{script}"]):
    raise RuntimeError("harness differs from frozen candidate")
order = [("warm1-d", "baseline"), ("warm1-d", "candidate"), ("warm2-d", "candidate"), ("warm2-d", "baseline")]
(out / "protocol.json").write_text(json.dumps({"revisions": revisions, "order": order,
    "scope": "offline replay; no live model, economic advantage or sealed holdout claim"}, indent=2) + "\n")
with tempfile.TemporaryDirectory(prefix="rcx-retained-result-") as tmp:
    for arm, revision in revisions.items():
        path = Path(tmp) / arm
        path.mkdir()
        with tarfile.open(fileobj=io.BytesIO(subprocess.check_output(["git", "archive", revision, "src", "package.json"]))) as archive:
            archive.extractall(path, filter="data")
    for index, (phase, arm) in enumerate(order):
        stem = f"{index + 1}-{arm}-{phase}"
        command = ["node", script, str(Path(tmp) / arm), phase, str(out / f"{stem}.json")]
        result = subprocess.run(command, capture_output=True, text=True)
        (out / f"{stem}.process.json").write_text(json.dumps({"command": command, "exitCode": result.returncode,
            "stdout": result.stdout, "stderr": result.stderr}, indent=2) + "\n")
        print(json.dumps({"attempt": stem, "exitCode": result.returncode, "stdout": result.stdout}), flush=True)
        if result.returncode:
            raise RuntimeError("failed replay retained: " + stem)

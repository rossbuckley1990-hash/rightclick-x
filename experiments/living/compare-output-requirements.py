"""Six sequential, fresh-process offline replays of two immutable Git sources.
No model calls, network, installation or branch changes. Keep every attempt.
"""
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
revisions = {name: subprocess.check_output(["git", "rev-parse", f"{ref}^{{commit}}"], text=True).strip()
             for name, ref in [("baseline", baseline), ("candidate", candidate)]}
script = "experiments/living/measure-output-requirements.ts"
if Path(script).read_bytes() != subprocess.check_output(["git", "show", f"{revisions['candidate']}:{script}"]):
    raise RuntimeError("replay script must match candidate freeze")
(out / "protocol.json").write_text(json.dumps({"revisions": revisions,
    "order": ["baseline", "candidate", "candidate", "baseline", "baseline", "candidate"],
    "scope": "exposed offline refusal diagnostic; not model economics or a holdout"}, indent=2) + "\n")
with tempfile.TemporaryDirectory(prefix="rcx-output-requirements-") as temporary:
    roots = {}
    for arm, revision in revisions.items():
        root = Path(temporary) / arm
        root.mkdir()
        archive = subprocess.check_output(["git", "archive", revision, "src", "package.json"])
        with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
            tar.extractall(root, filter="data")
        roots[arm] = root
    for index, arm in enumerate(["baseline", "candidate", "candidate", "baseline", "baseline", "candidate"]):
        name = f"{index + 1}-{arm}"
        command = ["node", script, str(roots[arm]), str(out / f"{name}.json")]
        result = subprocess.run(command, text=True, capture_output=True)
        (out / f"{name}.process.json").write_text(json.dumps({"command": command,
            "exitCode": result.returncode, "stdout": result.stdout, "stderr": result.stderr}, indent=2) + "\n")
        print(json.dumps({"attempt": name, "exitCode": result.returncode, "stdout": result.stdout}), flush=True)
        if result.returncode:
            raise RuntimeError(f"retained failed replay: {name}")

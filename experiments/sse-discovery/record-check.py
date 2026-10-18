"""Record an unmodified command's exit status, duration and complete output."""
import json
import pathlib
import subprocess
import sys
import time

checkout, evidence, label, *command = sys.argv[1:]
output = pathlib.Path(evidence)
output.mkdir(parents=True, exist_ok=True)
start = time.time()
with (output / (label + ".log")).open("wb") as log:
    result = subprocess.run(command, cwd=checkout, stdout=log, stderr=subprocess.STDOUT)
record = {"checkout": checkout, "command": command, "exit_code": result.returncode,
          "started_unix": start, "seconds": time.time() - start}
(output / (label + ".command.json")).write_text(json.dumps(record, indent=2) + "\n")
print(json.dumps({"check": label, **record}))
print((output / (label + ".log")).read_text(errors="replace")[-1200:])
sys.exit(result.returncode)

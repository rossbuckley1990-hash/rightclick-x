"""Hash and accounting audit for the retained output-requirement increment."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

root = Path(__file__).resolve().parents[2]
manifest = json.loads(Path(sys.argv[1]).read_text())
for name, digest in manifest["files"].items():
    path = root / name
    if not path.is_relative_to(root) or ".." in Path(name).parts:
        raise ValueError("invalid manifest path")
    if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
        raise ValueError(f"hash mismatch: {name}")
    subprocess.run(["git", "ls-files", "--error-unmatch", name], cwd=root,
                   stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, check=True)
evidence = root / "docs/adaptive/evidence/output-requirements"
for name, passed, failed in [("native-tests-final.log", 480, 0), ("linux-tests-final.log", 81, 0),
                             ("regression-before.log", 3, 2), ("bracketed-name-before.log", 5, 1)]:
    log = (evidence / name).read_text()
    for key, value in [("pass", passed), ("fail", failed), ("cancelled", 0), ("skipped", 0)]:
        if not re.search(rf"^ℹ {key} {value}$", log, re.MULTILINE):
            raise ValueError(f"wrong {key}: {name}")
proof = (evidence / "proof-final.log").read_text()
if len(re.findall(r"^PASS ", proof, re.MULTILINE)) != 28 or "PASS: 28/28 checks" not in proof:
    raise ValueError("proof not complete")
results = []
for name in ["paired", "paired-final"]:
    result = subprocess.check_output([sys.executable, "-B", str(root / "experiments/living/check-output-requirements.py"),
                                      str(evidence / name)], cwd=root, text=True)
    results.append(json.loads(result))
subprocess.run([sys.executable, "-B", str(root / "experiments/living/test-output-requirements-checker.py")],
               cwd=root, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
initial = json.loads((evidence / "baseline-initial.json").read_text())
if (initial["requests"] != 0 or initial["executed"] or initial["published"]
        or initial["outcome"]["status"] != "unavailable" or initial["before"] != initial["after"]):
    raise ValueError("initial reproduction lost refusal")
subprocess.run(["git", "diff", "--quiet", "be84f20f9282a79c86de7b285e465c36739513e7", "--", "src"], cwd=root, check=True)
print(json.dumps({"status": "pass", "files": len(manifest["files"]), "replays": 13,
    "nativeTests": 480, "linuxTests": 81, "proofChecks": 28,
    "preservedFailures": {"startingRegression": 2, "initialCandidate": 1},
    "finalMedianMilliseconds": results[-1]["medianMilliseconds"],
    "review": "separate checker implementation, same author; not independent-author review"}, indent=2))

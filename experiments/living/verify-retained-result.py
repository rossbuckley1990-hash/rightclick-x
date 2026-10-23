"""Hash, frozen-source, regression and comparison accounting audit."""
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys

root = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("checker", Path(__file__).with_name("check-retained-result.py"))
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)
manifest = json.loads(Path(sys.argv[1]).read_text())
checker.insist(manifest["sourceRevision"] == checker.FINAL, "source freeze changed")
for name, digest in manifest["files"].items():
    path = root / name
    checker.insist(path.is_relative_to(root) and ".." not in Path(name).parts, "invalid manifest path")
    checker.insist(hashlib.sha256(path.read_bytes()).hexdigest() == digest, "hash mismatch: " + name)
    subprocess.run(["git", "ls-files", "--error-unmatch", name], cwd=root, check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
evidence = root / "docs/adaptive/evidence/retained-result"
for name, passed, failed in [("native-tests-final.log", 508, 0), ("linux-tests-final.log", 79, 0),
                            ("regression-before-corrected.log", 0, 3), ("subset-before.log", 6, 1)]:
    log = (evidence / name).read_text()
    for key, number in [("pass", passed), ("fail", failed), ("cancelled", 0), ("skipped", 0)]:
        checker.insist(bool(re.search(rf"^ℹ {key} {number}$", log, re.MULTILINE)), f"wrong {key}: {name}")
proof = json.loads((evidence / "proof-final.json").read_text())
checker.insist(proof["passed"] == proof["total"] == 28 and all(c["passed"] for c in proof["checks"]), "proof failed")
checker.insist(proof["sourceBefore"] == proof["sourceAfter"], "source changed during proof")
for name, digest in proof["sourceBefore"]["files"].items():
    checker.insist(hashlib.sha256(subprocess.check_output(["git", "show", f"{checker.FINAL}:{name}"], cwd=root)).hexdigest() == digest,
                    "proof source changed")
results = [checker.check(evidence / name) for name in ["paired", "paired-isolated", "paired-final"]]
subprocess.run([sys.executable, "-B", str(root / "experiments/living/test-retained-result-checker.py")], cwd=root,
               stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
subprocess.run(["git", "diff", "--quiet", checker.FINAL, "--", "src"], cwd=root, check=True)
print(json.dumps({"status": "pass", "sourceRevision": checker.FINAL, "files": len(manifest["files"]),
    "nativeTests": 508, "linuxTests": 79, "proofChecks": 28, "replays": 12, "callsPerReplay": 2,
    "rediscovery": 0, "republication": 0, "finalMeasurements": results[-1]["measurements"],
    "review": "same-author separate checker; independent-author review and commercial superiority remain unestablished"}, indent=2))

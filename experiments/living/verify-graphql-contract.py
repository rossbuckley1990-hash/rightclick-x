"""Hash, source, failure-retention and accounting audit for this increment."""
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys

root = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("checker", Path(__file__).with_name("check-graphql-contract.py"))
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)
manifest = json.loads(Path(sys.argv[1]).read_text())
checker.insist(manifest["sourceRevision"] == checker.FINAL, "manifest source changed")
for name, digest in manifest["files"].items():
    path = root / name
    checker.insist(path.is_relative_to(root) and ".." not in Path(name).parts, "invalid manifest path")
    checker.insist(hashlib.sha256(path.read_bytes()).hexdigest() == digest, f"hash mismatch: {name}")
    subprocess.run(["git", "ls-files", "--error-unmatch", name], cwd=root,
                   stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, check=True)
evidence = root / "docs/adaptive/evidence/graphql-contract"
for name, passed, failed in [("native-tests-complete.log", 501, 0), ("linux-tests-complete.log", 94, 0),
        ("regression-before-corrected-fixture.log", 2, 4), ("defaulted-field-before.log", 13, 1),
        ("root-default-before.log", 14, 1), ("malformed-before.log", 15, 1), ("type-references-before.log", 0, 3)]:
    log = (evidence / name).read_text()
    for key, value in [("pass", passed), ("fail", failed), ("cancelled", 0), ("skipped", 0)]:
        checker.insist(bool(re.search(rf"^ℹ {key} {value}$", log, re.MULTILINE)), f"wrong {key}: {name}")
proof = json.loads((evidence / "proof-complete.json").read_text())
checker.insist(proof["passed"] == proof["total"] == 28 and all(c["passed"] for c in proof["checks"]), "proof failed")
checker.insist(proof["sourceBefore"] == proof["sourceAfter"], "source changed during proof")
for path, digest in proof["sourceBefore"]["files"].items():
    data = subprocess.check_output(["git", "show", f"{checker.FINAL}:{path}"], cwd=root)
    checker.insist(hashlib.sha256(data).hexdigest() == digest, "proof source differs from freeze")
pairs = [checker.check(evidence / name) for name in ["paired", "paired-final", "paired-complete"]]
checker.check_result(json.loads((evidence / "baseline-initial.json").read_text()), "baseline", checker.BASELINE)
public = checker.check_public(evidence / "public-attempt3")
network_requests = public["requests"]
network_bytes = public["responseBytes"]
for name, count, reason in [("public", 3, "no eligible query advertised"),
                            ("public-attempt2", 4, "insufficient scalar selection evidence")]:
    folder = evidence / name
    failure = json.loads((folder / "failure.json").read_text())
    rows = list(map(json.loads, (folder / "network.jsonl").read_text().splitlines()))
    checker.insist(failure["requests"] == len(rows) == count and reason in failure["error"], "public failure lost")
    for row in rows:
        checker.insist(len((folder / f"response-{row['id']}.bin").read_bytes()) == row["bytes"], "failed trial bytes changed")
    network_requests += count
    network_bytes += sum(r["bytes"] for r in rows)
checker.insist(network_requests == 14 and network_bytes == 63243, "public accounting changed")
subprocess.run([sys.executable, "-B", str(root / "experiments/living/test-graphql-contract-checker.py")],
               cwd=root, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
subprocess.run(["git", "diff", "--quiet", checker.FINAL, "--", "src"], cwd=root, check=True)
print(json.dumps({"status": "pass", "files": len(manifest["files"]), "sourceRevision": checker.FINAL,
    "replays": 19, "nativeTests": 501, "linuxTests": 94, "proofChecks": 28,
    "finalMedianMilliseconds": pairs[-1]["medianMilliseconds"], "public": public,
    "allPublicAttempts": {"trials": 3, "requests": network_requests, "responseBytes": network_bytes, "failedTrials": 2},
    "review": "separate checker implementation, same author; independent-author review remains open"}, indent=2))

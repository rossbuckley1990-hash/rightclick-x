"""Cold native verifier process measurements on fixed signed evidence."""
import hashlib
import json
from pathlib import Path
import statistics
import subprocess
import sys
import time

root = Path(__file__).resolve().parents[2]
trial = Path(sys.argv[1]).resolve()
public = trial / "boundary/public.json"
origin = json.loads((trial / "boundary-ready.json").read_text())["origin"]
base = [sys.executable, "-B", str(root / "integrations/actenon/authority-evidence.py"),
    "--attestations", str(trial / "boundary/attestations.jsonl"), "--public-key", str(public),
    "--trust-anchor", hashlib.sha256(public.read_bytes()).hexdigest(), "--origin", origin, "--issuer", "resource-edge"]
samples = []
for n in range(5):
    for linked in ([False, True] if n % 2 == 0 else [True, False]):
        command = base + (["--transport-links", str(trial / "boundary/issuer/transport-links.jsonl")] if linked else [])
        start = time.monotonic()
        result = subprocess.run(command, capture_output=True, timeout=3, check=True)
        elapsed = (time.monotonic() - start) * 1000
        batch = json.loads(result.stdout)
        count = sum("runtimeLink" in row for row in batch["records"])
        assert bool(count) == linked
        samples.append({"pair": n, "linked": linked, "milliseconds": elapsed,
            "projectedBytes": len(result.stdout), "artifacts": len(batch["records"]), "links": count})
medians = {str(k): statistics.median(r["milliseconds"] for r in samples if r["linked"] == k) for k in (False, True)}
print(json.dumps({"samples": samples, "medianMilliseconds": medians,
    "scope": "five alternating cold verifier-process pairs on fixed signed local evidence; includes Python startup, no network or model cost"}, indent=2))

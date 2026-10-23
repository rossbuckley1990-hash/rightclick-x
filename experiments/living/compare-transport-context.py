"""Alternating fresh-process pairs against preserved source, never switches branch."""
import io
import json
from pathlib import Path
import statistics
import subprocess
import sys
import tarfile
import tempfile

root = Path(__file__).resolve().parents[2]
baseline = sys.argv[1]
samples = []
with tempfile.TemporaryDirectory(prefix="rcx-transport-baseline-") as tmp:
    archive = subprocess.check_output(["git", "archive", baseline, "src"], cwd=root)
    with tarfile.open(fileobj=io.BytesIO(archive)) as source:
        source.extractall(tmp, filter="data")
    Path(tmp, "package.json").write_text('{"type":"module"}')
    for n in range(5):
        for kind in (["baseline", "current"] if n % 2 == 0 else ["current", "baseline"]):
            path = tmp if kind == "baseline" else root
            run = subprocess.run(["node", str(root / "experiments/living/measure-transport-context.ts"), str(path)],
                capture_output=True, text=True, timeout=30, check=True)
            result = json.loads(run.stdout)
            assert result["requests"] == 1100 and result["graphBefore"] == result["graphAfter"]
            assert result["contexts"] == (0 if kind == "baseline" else 1100)
            samples.append({"pair": n, "source": kind, **result})
median = {kind: statistics.median(r["milliseconds"] for r in samples if r["source"] == kind) for kind in ("baseline", "current")}
print(json.dumps({"baseline": baseline, "current": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip(),
    "samples": samples, "medianMillisecondsPer1000": median,
    "medianRatio": median["current"] / median["baseline"],
    "scope": "deterministic in-memory HTTP overhead; five alternating process pairs, no inference cost, network latency, security certification or commercial superiority"}, indent=2))

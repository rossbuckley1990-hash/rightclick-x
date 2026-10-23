#!/usr/bin/env python3
"""Run identical development regressions against frozen and current source.

No network, model, installed dependency, or mutation of the engineering checkout.
This is a before/after regression check, not a holdout or coding-agent benchmark.
"""
import io
import json
import pathlib
import shutil
import subprocess
import tarfile
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[3]
BASELINE = "42c46e092fbccd8304ec89623c496691ebf37749"
harness = (HERE / "baseline-regression.ts.txt").read_text()
archive = subprocess.check_output(["git", "archive", BASELINE, "src", "demo", "package.json", "test/helpers.ts"], cwd=ROOT)
results = {}
for label in ["baseline", "candidate"]:
    with tempfile.TemporaryDirectory(prefix="rcx-links-" + label + "-") as temporary:
        path = pathlib.Path(temporary)
        with tarfile.open(fileobj=io.BytesIO(archive)) as bundle:
            bundle.extractall(path, filter="data")
        if label == "candidate":
            shutil.copytree(ROOT / "src", path / "src", dirs_exist_ok=True)
        (path / "test/contract-links.test.ts").write_text(harness)
        run = subprocess.run(["node", "--test", "test/contract-links.test.ts"], cwd=path, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        (HERE / (label + "-comparison.log")).write_bytes(run.stdout)
        results[label] = {"exit": run.returncode}
(HERE / "comparison-process.json").write_text(json.dumps({"baseline": BASELINE, "results": results}, indent=2) + "\n")
print(json.dumps(results))
assert results["baseline"]["exit"] == 1 and results["candidate"]["exit"] == 0, results

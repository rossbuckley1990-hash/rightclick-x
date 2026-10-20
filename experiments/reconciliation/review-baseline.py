"""Run the review regressions against the original PR head without altering any checkout."""
from pathlib import Path
import io
import shutil
import subprocess
import sys
import tarfile
import tempfile

root = Path(__file__).resolve().parents[2]
baseline = "492da01d2891995685cb7b363c9cdcf3e571193c"
archive = subprocess.check_output(["git", "archive", baseline, "src", "demo", "package.json"], cwd=root)
with tempfile.TemporaryDirectory(prefix="rcx-pr3-review-") as directory:
    target = Path(directory)
    with tarfile.open(fileobj=io.BytesIO(archive)) as stored:
        stored.extractall(target, filter="data")
    (target / "test").mkdir()
    shutil.copyfile(root / "test/review-boundaries.test.ts", target / "test/review-boundaries.test.ts")
    print("Frozen product:", baseline, flush=True)
    result = subprocess.run(["node", "--test", "test/review-boundaries.test.ts"], cwd=target)
sys.exit(result.returncode)

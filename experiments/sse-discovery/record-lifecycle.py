"""Run the existing lifecycle proof, retaining its output without replacing prior evidence."""
from pathlib import Path
import subprocess
import sys

path = Path("proof/results/latest.json")
before = path.read_bytes() if path.exists() else None
try:
    result = subprocess.run(["node", "proof/run.ts", "20261018"])
    Path(sys.argv[1]).write_bytes(path.read_bytes())
finally:
    if before is not None:
        path.write_bytes(before)
    elif path.exists():
        path.unlink()
sys.exit(result.returncode)

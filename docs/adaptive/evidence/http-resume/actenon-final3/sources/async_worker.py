"""Fixed trusted fixture worker; input is data, never executable source."""
import gzip
import json
from pathlib import Path
import sys

job = json.loads(Path(sys.argv[1]).read_text())
output = Path(job["output"]) / (job["label"] + ".gz")
temporary = output.with_suffix(".tmp")
temporary.write_bytes(gzip.compress(job["document"].encode(), mtime=0))
temporary.replace(output)

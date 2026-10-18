"""Reproduce the recorded alternating six-pair workload with parent timeouts.

This driver codifies the original shell-invoked Python loop; it was saved after
the recorded runs. The worker and measured product were frozen before those runs.
"""
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import sys
import time

before_root, before_revision, after_root, after_revision, output = sys.argv[1:]
repo = Path(__file__).resolve().parents[2]
base = Path(output).resolve()
base.mkdir(parents=True, exist_ok=False)
roots = {'before': str(Path(before_root).resolve()), 'after': str(Path(after_root).resolve())}
revisions = {'before': before_revision, 'after': after_revision}
for pair in range(1, 7):
    for mode in ['plans', 'publish']:
        for arm in (['before', 'after'] if pair % 2 else ['after', 'before']):
            label = f'paired-{mode}-{pair}-{arm}'
            command = ['node', str(repo/'experiments/north-star/planner-replay.mjs'), roots[arm], revisions[arm], str(base/label), mode]
            start = time.monotonic()
            with (base/f'{label}.log').open('xb') as log:
                try:
                    run = subprocess.run(command, cwd=repo, stdout=log, stderr=subprocess.STDOUT, timeout=55)
                    status = {'exitCode': run.returncode, 'stopped': False}
                except subprocess.TimeoutExpired:
                    status = {'exitCode': None, 'stopped': True}
            status.update({'command': command, 'seconds': time.monotonic()-start, 'at': datetime.now(timezone.utc).isoformat(), 'timeoutSeconds': 55, 'pair': pair, 'arm': arm, 'mode': mode})
            (base/f'{label}-process.json').write_text(json.dumps(status, indent=2)+'\n')
            print(label, status['exitCode'], round(status['seconds'], 3), flush=True)
            if status['exitCode'] != 0:
                raise SystemExit('Failed or stopped; raw evidence preserved.')

"""Corrupt copies of a valid pilot row; never execute recorded model code.

Uses the existing raw checker without weakening it. Same-author validation only.
Output directories are exclusive so failed controls cannot be overwritten.
"""
import copy
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys


root = Path(sys.argv[1]).resolve()
result = json.loads((root / 'results.json').read_text())
source_row = next(r for r in result['sessions'] if r['correct'] and r['phase'] == 'first' and r['observation']['taskExecutionObserved'])
controls = root / 'negative-controls'
controls.mkdir()
summary = {'scope': 'Synthetic corruptions of copied raw evidence; no model or recorded code executed', 'sourceAttempt': source_row['attemptId'], 'controls': {}}

for kind in ['altered-task-output-with-updated-digest', 'inflated-tokens', 'concealed-io']:
    target = controls / kind
    target.mkdir()
    shutil.copy2(root / 'manifest.json', target / 'manifest.json')
    attempts = target / 'results.json.attempts'
    attempts.mkdir()
    for location in result['preflights']:
        name = Path(location).name
        shutil.copytree(root / 'results.json.attempts' / name, attempts / name)
    data = copy.deepcopy(result)
    data['sessions'] = [copy.deepcopy(source_row)]
    row = data['sessions'][0]
    directory = attempts / row['attemptId']
    shutil.copytree(root / 'results.json.attempts' / row['attemptId'], directory)
    if kind == 'altered-task-output-with-updated-digest':
        file = directory / 'sandbox.jsonl'
        records = [json.loads(line) for line in file.read_text().splitlines()]
        ids = {r['id'] for r in records if r['type'] == 'started' and r['purpose'] in ['execution', 'agent-run']}
        changed = 0
        for record in records:
            if record['type'] == 'finished' and record['id'] in ids:
                record['result']['stdout'] = 'CORRUPTED TASK RESULT\n'
                changed += 1
        assert changed > 0, 'must alter task output, not only help/probe evidence'
        file.write_text(''.join(json.dumps(r) + '\n' for r in records))
        row['observation']['sha256'] = hashlib.sha256(file.read_bytes()).hexdigest()
    elif kind == 'inflated-tokens':
        row['tokens'] += 1
    else:
        file = directory / 'agent-tools.jsonl'
        records = [json.loads(line) for line in file.read_text().splitlines()]
        call = next(r['payload'] for r in records if r['payload']['type'] == 'custom_tool_call' and r['payload']['name'] in ['exec', 'functions.exec'])
        call['input'] += '\nvoid process.env; // synthetic forbidden access, parsed only\n'
        file.write_text(''.join(json.dumps(r) + '\n' for r in records))
    (directory / 'result.json').write_text(json.dumps(row, indent=2) + '\n')
    (target / 'results.json').write_text(json.dumps(data, indent=2) + '\n')
    checked = subprocess.run([sys.executable, str(Path(__file__).with_name('check-codex-development.py')), str(target)], capture_output=True, text=True)
    (target / 'checker.stdout').write_text(checked.stdout)
    (target / 'checker.stderr').write_text(checked.stderr)
    assert checked.returncode != 0 and 'AssertionError' in checked.stderr, f'control not rejected: {kind}'
    summary['controls'][kind] = {'rejected': True, 'exit': checked.returncode}

(controls / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
print(json.dumps(summary, indent=2))

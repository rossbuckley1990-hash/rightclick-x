"""Reconcile the one recorded laptop-sleep interruption without rewriting raw results.

The original raw checker refuses retries without separate reconciliation. This
creates an explicitly labelled completed-session view, preserving every raw row
and the interrupted session's incomplete resource accounting alongside it.
"""
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys

root = Path(sys.argv[1]).resolve()
read = lambda p: json.loads(p.read_text())
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
result = read(root / 'results.json')
stopped = read(root / 'stopped-after-sleep.json')
failure = read(root / 'interruption.json')
assert len(result['sessions']) == 32 and len(result['previousAttempts']) == 1
bad = result['previousAttempts'][0]
assert bad == next(s for s in stopped['sessions'] if s['attemptId'] == failure['attemptId'])
assert bad['key'] == 'A|json_xs|t1' and bad['blocked'] and not bad['correct']
assert bad.get('tokens') is None and bad['seconds'] == failure['recordedSeconds']
assert result['commit'] == stopped['commit'] and result['holdoutSha256'] == stopped['holdoutSha256']
assert all(s == next(r for r in result['sessions'] if r['attemptId'] == s['attemptId']) for s in stopped['sessions'] if not s.get('blocked'))
replacement = next(s for s in result['sessions'] if s['key'] == bad['key'])
assert replacement['attemptId'] != bad['attemptId'] and not replacement.get('blocked')
directory = root / 'results.json.attempts' / bad['attemptId']
assert read(directory / 'result.json') == bad
assert read(directory / 'agent-exit.json') == {'code': 0, 'timedOut': True}
events = [json.loads(l) for l in (directory / 'agent.stdout').read_text().splitlines() if l]
assert not any(e['type'] == 'turn.completed' for e in events)
assert sha(directory / 'sandbox.jsonl') == bad['observation']['sha256']
assert len((directory / 'calls.jsonl').read_text().splitlines()) == bad['toolCalls'] == 1
usage = read(directory / 'recovered-usage.json')
audit = read(directory / 'agent-audit.json')
assert not audit['violations'] and usage['threadId'] == audit['threadId']
assert events[0]['thread_id'] == usage['threadId']
snapshot = usage['records'][-1]['payload']['info']['total_token_usage']
assert snapshot['input_tokens'] + snapshot['output_tokens'] == snapshot['total_tokens'] == failure['recoveredReportedTokens']
sleep = read(root / 'sleep-evidence.json')['events']
assert sleep[0]['event'] == 'Sleep' and 'Clamshell Sleep' in sleep[0]['detail']
assert sleep[-1]['event'] == 'Wake' and 'UserActivity' in sleep[-1]['detail']

view = root / 'completed-session-view'
view.mkdir()
(view / 'results.json.attempts').symlink_to('../results.json.attempts', target_is_directory=True)
(view / 'manifest.json').write_bytes((root / 'manifest.json').read_bytes())
projection = copy.deepcopy(result)
projection['previousAttempts'] = []
projection['validationProjection'] = {'rawResults': '../results.json', 'sha256': sha(root / 'results.json'),
    'scope': 'Completed rows only for the unchanged raw checker; excluded interruption is reconciled in ../attempt-accounting.json'}
(view / 'results.json').write_text(json.dumps(projection, indent=2) + '\n')
checked = subprocess.run([sys.executable, str(Path(__file__).with_name('check-codex-development.py')), str(view)], capture_output=True, text=True)
(root / 'final-checker.json').write_text(checked.stdout)
(root / 'final-checker.stderr').write_text(checked.stderr)
assert checked.returncode == 0, checked.stderr
assert json.loads(checked.stdout)['fullPlanned32'] is True
report = {'scope': 'Completed-session validation plus one explicitly reconciled host-sleep interruption; same-author checking',
    'rawResultsSha256': sha(root / 'results.json'), 'stoppedSnapshotSha256': sha(root / 'stopped-after-sleep.json'),
    'completedViewSha256': sha(view / 'results.json'), 'validSessions': 32, 'excludedAttempts': [bad['attemptId']],
    'excludedReason': 'Incomplete timed-out model session spanning independently observed host sleep; not a scored model-performance failure',
    'invalidHostElapsedSeconds': bad['seconds'], 'incompleteSessionReportedTokenSnapshot': snapshot['total_tokens'],
    'interruptedFinalTokenTotal': None, 'replacementAttempt': replacement['attemptId'],
    'completedChecker': 'PASS', 'limitations': ['Interrupted final token usage remains unknown; snapshot is not a complete total.', 'Fixed ordering and service/load differences prevent causal or population timing claims.', 'No independent-author validation.']}
with (root / 'attempt-accounting.json').open('x') as out:
    json.dump(report, out, indent=2)
    out.write('\n')
print(json.dumps(report, indent=2))

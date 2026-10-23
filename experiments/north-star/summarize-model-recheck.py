"""Descriptive recheck accounting. Raw correctness is checked separately.

No API-equivalent prices, causal attribution or significance inference.
"""
import hashlib
import json
from pathlib import Path
import statistics
import sys


root, previous = map(Path, sys.argv[1:])
result = json.loads((root / 'results.json').read_text())
old = json.loads((previous / 'results.json').read_text())
checked = json.loads((root / 'final-checker.json').read_text())
assert checked['fullPlanned32'] is True and len(result['sessions']) == 32
accounting = json.loads((root / 'attempt-accounting.json').read_text())
assert accounting['rawResultsSha256'] == hashlib.sha256((root / 'results.json').read_bytes()).hexdigest()
assert accounting['excludedAttempts'] == [s['attemptId'] for s in result['previousAttempts']]
assert json.loads((root / 'manifest.json').read_text())['programs'] == json.loads((previous / 'manifest.json').read_text())['programs']


def summarize(data, data_root):
    groups = {}
    for arm in 'ABCD':
        group = [s for s in data['sessions'] if s['arm'] == arm]
        warm = [s for s in group if s['phase'] == 'reuse']
        feasible = [s for s in group if s['phase'] in ['first', 'reuse']]
        assert len(group) == 8 and len(warm) == 3 and len(feasible) == 4
        setup_seconds = 0
        for s in group:
            file = data_root / 'results.json.attempts' / s['attemptId'] / 'launch-preflight.json'
            if file.exists():
                setup_seconds += json.loads(file.read_text())['seconds']
        groups[arm] = {
            'feasibleCorrect': sum(s['correct'] for s in feasible),
            'prescribedCorrect': sum(s['correct'] for s in group),
            'scorerWrong': sum(s['wrong'] for s in group),
            'wrongValueAnswers': sum(s['wrong'] and not s['matchesOracle'] for s in group),
            'correctValuesFailingRefusal': sum(s['wrong'] and s['matchesOracle'] for s in group),
            'coldSeconds': next(s['seconds'] for s in group if s['phase'] == 'first'),
            'warmMedianSeconds': statistics.median(s['seconds'] for s in warm),
            'warmMedianReportedTokens': statistics.median(s['tokens'] for s in warm),
            'totalSeconds': sum(s['seconds'] for s in group),
            'totalReportedTokens': sum(s['tokens'] for s in group),
            'warmToolCalls': [s['toolCalls'] for s in warm],
            'warmInvestigations': [s['investigationsStarted'] for s in warm],
            'warmInvocations': [s['observation']['invocations'] for s in warm],
            'oracleSetupSeconds': setup_seconds,
        }
    return groups


groups, oldgroups = summarize(result, root), summarize(old, previous)
report = {'freeze': result['commit'], 'developmentOnly': True,
          'scope': 'Same exposed tasks, new fresh sessions; fixed order and uncontrolled service variation. Descriptive only, no causal or monetary claim.',
          'groups': groups, 'previousGroups': oldgroups,
          'sessionSeconds': sum(s['seconds'] for s in result['sessions']),
          'reportedTokens': sum(s['tokens'] for s in result['sessions']),
          'newPreviousAttempts': len(result['previousAttempts']),
          'interruptedAttempt': accounting,
          'preservedEarlierCosts': 'Original complete and stopped pilot costs remain recorded in CODEX-DEVELOPMENT-RESULT.md; not erased or reallocated.',
          'candidateWarmTimeRatioToBaseline': {a: groups['D']['warmMedianSeconds'] / groups[a]['warmMedianSeconds'] for a in 'ABC'},
          'candidateWarmTimeRatioToPrevious': groups['D']['warmMedianSeconds'] / oldgroups['D']['warmMedianSeconds'],
          'resultsSha256': hashlib.sha256((root / 'results.json').read_bytes()).hexdigest(),
          'previousResultsSha256': hashlib.sha256((previous / 'results.json').read_bytes()).hexdigest()}
with (root / 'summary.json').open('x') as out:
    json.dump(report, out, indent=2)
    out.write('\n')
print(json.dumps(report, indent=2))

"""Checker regression using preserved older traces, with test-only envelopes.

This test is not presented as a new persistent-runtime or model observation.
"""
import base64
import copy
import importlib.util
import json
from pathlib import Path

script = Path(__file__).with_name('check-session-models.py')
spec = importlib.util.spec_from_file_location('combined_checker', script)
checker = importlib.util.module_from_spec(spec); spec.loader.exec_module(checker)
root = Path('docs/adaptive/evidence/fresh-public-reuse/attempt3')
sessions = json.loads((root / 'sessions.json').read_text())[:3]
# The independently read expected values are stored alongside this trial.
expected_path = Path('docs/adaptive/evidence/fresh-public-reuse/oracle-final/expected.json')
expected = json.loads(expected_path.read_text())
rows, tools, wires = [], [], []
for original in sessions:
    session = copy.deepcopy(original); directory = root / session['task']['id']
    calls = checker.prior.jsonl(directory / 'mcp.jsonl')
    network = checker.prior.jsonl(directory / 'network.jsonl')
    session.update(before={'toolCalls': len(tools), 'totalRequests': len(wires)}, tools=calls, publicRequests=network)
    tools.extend(calls)
    wires.extend({'method': r['method'], 'url': r['url'], 'headers': {},
        'body': base64.b64encode(r.get('body', '').encode()).decode()} for r in network)
    session['after'] = {'toolCalls': len(tools), 'totalRequests': len(wires)}
    rows.append({'session': session, 'events': checker.prior.jsonl(directory / 'agent.stdout'),
        'audit': json.loads((directory / 'agent-audit.json').read_text())})
result = checker.verify(rows, expected, tools, wires)
assert result['positiveOutcomes'] == 2 and result['missingResourceRefusals'] == 1
rejected = []
for name in ['answer', 'discovery', 'model', 'tokens', 'thread', 'wire', 'tools']:
    bad, changed_tools, changed_wires = copy.deepcopy((rows, tools, wires))
    if name == 'answer': bad[0]['session']['reply'] = 'BEGIN\n{}\nEND'
    elif name == 'discovery': bad[0]['session']['publicRequests'][0]['discovery'] = True
    elif name == 'model': bad[0]['audit']['contexts'][0]['model'] = 'wrong'
    elif name == 'tokens': bad[0]['session']['tokens'] += 1
    elif name == 'thread': bad[1]['audit']['threadId'] = bad[0]['audit']['threadId']
    elif name == 'wire': changed_wires[0]['url'] += '/wrong'
    else: changed_tools.pop()
    try: checker.verify(bad, expected, changed_tools, changed_wires)
    except ValueError: rejected.append(name)
    else: raise AssertionError('accepted ' + name)
print(json.dumps({'status': 'PASS', 'controls': rejected,
    'scope': 'checker unit replay of preserved older traces with reconstructed test envelopes, not new model evidence'}, indent=2))

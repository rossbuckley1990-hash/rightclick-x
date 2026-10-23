#!/usr/bin/env python3
"""Separate stdlib-only raw-artifact checker; no RightClick/TS scorer imports.
This checks a declared development fixture. It is not an independent-author review.
"""
import hashlib
import json
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
summary = json.loads((root / 'summary.json').read_text())
expected = {'baseline': ('baseline input\n', 0, 1), 'cold': ('cold input\n', 1, 1),
            'warm': ('fresh process input\n', 0, 1), 'builtin': (None, 0, 0)}
checks = []
for name, (input_text, investigation_count, execution_count) in expected.items():
    raw = (root / f'{name}.jsonl').read_bytes()
    assert raw.endswith(b'\n'), f'{name}: truncated'
    rows = [json.loads(line) for line in raw.splitlines()]
    assert rows[0]['type'] == 'ready' and rows[-1]['type'] == 'closed', f'{name}: incomplete'
    target = rows[0]['target']
    assert all(r['schema'] == 1 and r['sessionId'] == name and r['target'] == target and r['sequence'] == i for i, r in enumerate(rows)), f'{name}: binding'
    assert hashlib.sha256(raw).hexdigest() == summary['observations'][name]['sha256'], f'{name}: digest'
    invs = [r for r in rows if r['type'] == 'investigation']
    assert len(invs) == investigation_count, f'{name}: investigation count'
    assert all(r['program'] == target for r in invs)
    starts = {r['id']: r for r in rows if r['type'] == 'started'}
    ends = {r['id']: r for r in rows if r['type'] == 'finished'}
    assert len(starts) == sum(r['type'] == 'started' for r in rows), f'{name}: duplicate start'
    assert len(ends) == sum(r['type'] == 'finished' for r in rows), f'{name}: duplicate end'
    assert starts.keys() == ends.keys(), f'{name}: unmatched invocation'
    assert not any(r['type'] == 'error' for r in rows), f'{name}: execution error'
    executions = [r for r in starts.values() if r['purpose'] in ('execution', 'agent-run')]
    assert len(executions) == execution_count, f'{name}: execution count'
    for start in executions:
        end = ends[start['id']]
        assert start['program'] == target and start['identity'] == end['identity'], f'{name}: identity'
        assert start['identity']['sha256'] == summary['targetSha256'], f'{name}: fixture identity'
        assert start['stdin'] == input_text, f'{name}: wrong supplied input'
        result = end['result']
        assert result['stdout'] == input_text.upper(), f'{name}: wrong observed output'
        assert result['code'] == 0 and not result['timedOut'] and not result['truncated'] and not result.get('limit'), f'{name}: unusable execution'
    if name in ('warm', 'builtin'):
        assert not any(r['purpose'] in ('investigation', 'revalidation') for r in starts.values()), f'{name}: hidden reacquisition'
    scored = summary['observations'][name]
    assert scored['complete'] and scored['taskExecutionObserved'] == bool(execution_count)
    assert scored['investigationsStarted'] == (None if name == 'baseline' else investigation_count)
    checks.append({'session': name, 'investigations': investigation_count, 'executions': execution_count, 'pass': True})
print(json.dumps({'scope': 'separate raw-fixture recheck; not independent-author review or model economics', 'checks': checks}, indent=2))

"""Separate raw-artifact checker. Same author, no product imports; not external security review."""
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parents[2]


def check(report, after):
    assert not report['sourceDirty']
    for name, digest in report['sourceHashes'].items():
        source = subprocess.check_output(['git', 'show', report['sourceCommit'] + ':' + name], cwd=root)
        assert hashlib.sha256(source).hexdigest() == digest, name
    cap = report['capability']
    allowed = {f for o in cap['invoke']['options']['allowed'] for f in o['flags']}
    assert '-d' in allowed and all('-'+s in allowed for s in 'eras')
    assert '-delete' not in allowed and '-erase' not in allowed
    if after:
        assert {'-delete', '-erase'} <= set(cap['invoke']['options']['excluded'])
    expected = [['-d', 'compact'], ['-dcompact'], ['-delete'], ['-erase']]
    assert [c['options'] for c in report['cases']] == expected
    for i, case in enumerate(report['cases']):
        response = case['response']
        assert response['verification']['status'] != 'verified'
        if after and i >= 2:
            assert response['status'] == 'failed' and 'excluded' in response['error']
            assert case['wires'] == [] and not response.get('healing')
            continue
        assert response['status'] == 'completed'
        assert len(case['wires']) == 1
        wire = case['wires'][0]
        assert wire['options']['files'] == {'record.txt': 'record content\n'}
        argv = ['-d', 'compact'] if after and i < 2 else expected[i]
        assert wire['args'] == argv + ['record.txt']
        assert wire['result']['code'] == 0 and not wire['result']['timedOut'] and not wire['result']['truncated']
        text = 'FORMAT:compact\nrecord content\n' if i < 2 else 'REMOVED\n'
        assert response['output'] == wire['result']['stdout'] == text
    return {'sourceCommit': report['sourceCommit'], 'cases': 4, 'permittedControls': 2, 'excludedDispatches': 0 if after else 2, 'excludedRefusals': 2 if after else 0}


if __name__ == '__main__':
    assert len(sys.argv) == 3, 'provide before.json and after.json'
    before, after = [json.loads(Path(p).read_text()) for p in sys.argv[1:]]
    assert before['programSource'] == after['programSource'], 'fixture changed'
    result = {'scope': 'synthetic sandbox-local admission defect, no host escape or model claim', 'before': check(before, False), 'after': check(after, True)}
    forged = copy.deepcopy(after)
    forged['cases'][2]['wires'] = before['cases'][2]['wires']
    try:
        check(forged, True)
    except AssertionError:
        result['falseRefusalWithDispatchRejected'] = True
    else:
        raise AssertionError('checker accepted a dispatched refusal')
    print(json.dumps(result, indent=2))

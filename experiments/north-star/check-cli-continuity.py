"""Supplement to the unchanged lifecycle checker. Stdlib only; same author, not external review."""
import copy
import hashlib
import json
import re
import subprocess
from pathlib import Path
import sys


def capability(state):
    return next(c for r in state['reflections'] for c in r['capabilities'] if c['id'] == 'cli:json-xs:stdout')


def observation(example):
    return {k: v for k, v in example.items() if k != 'outputPreview'}


def check(before, after, raw, expected_semantics=25):
    old, new = capability(before), capability(after)
    oi, ni = old['invoke'], new['invoke']
    assert before['semantics'] == 22 and after['semantics'] == expected_semantics
    assert old['id'] == new['id'] and old['source'] == new['source'] == 'cli'
    assert old['risk'] == new['risk'] == 'read'
    assert oi['sha256'] == ni['sha256'] and oi['behaviour'] != ni['behaviour']
    ignored = {'behaviour', 'examples', 'continuity'}
    assert {k: v for k, v in oi.items() if k not in ignored} == {k: v for k, v in ni.items() if k not in ignored}, 'changed invocation'
    for key in ['inputs', 'outputs']:
        assert [{k: v for k, v in p.items() if k != 'description'} for p in old[key]] == [{k: v for k, v in p.items() if k != 'description'} for p in new[key]], 'changed port contract'
    lineage = next(e for e in ni['continuity'] if e['behaviour'] == oi['behaviour'])
    assert lineage['examples'] == oi['examples'] and lineage['examples']
    fresh = [observation(e) for e in ni['examples']]
    for example in lineage['examples']:
        assert observation(example) in fresh, 'old observation absent from new evidence'
        # This exposed replay uses only stdin and no fixed option/literal/file arguments.
        assert set(example) <= {'stdin', 'outputSha256', 'outputPreview'} and ni['args'] == []
        matches = [w for w in raw['wires'] if w['program'] == ni['bin'] and w['args'] == [] and
                   w['opts'].get('purpose') == 'investigation' and w['opts'].get('stdin') == example['stdin']]
        assert matches, 'no actual fresh probe for old observation'
        for wire in matches:
            result = wire['result']
            assert wire['before'] == wire['after'] and wire['before']['sha256'] == ni['sha256']
            assert result['code'] in ni['okExit'] and not result['timedOut'] and not result['truncated'] and not result.get('limit')
            assert hashlib.sha256(result['stdout'].encode()).hexdigest() == example['outputSha256']
    assert not any(c['id'] == old['id'] for c in after.get('meaningChanges', []))
    assert raw['response']['status'] == 'completed' and raw['response']['verification']['status'] == 'checked'
    return {'oldFingerprint': oi['behaviour'], 'newFingerprint': ni['behaviour'], 'oldExamples': len(lineage['examples']),
            'distinctOldInputs': len({e['stdin'] for e in lineage['examples']}), 'sameBinary': True,
            'sameInvocationAndPorts': True, 'oldExamplesMatchedFreshRawProbes': True}


if __name__ == '__main__':
    assert len(sys.argv) in [3, 4], 'provide BEFORE_DIR AFTER_DIR [EXPECTED_SEMANTICS=25]'
    expected_semantics = int(sys.argv[3]) if len(sys.argv) == 4 else 25
    bp, ap = map(Path, sys.argv[1:3])
    manifest = json.loads((ap / 'manifest.json').read_text())
    source = subprocess.check_output(['git', 'show', f"{manifest['commit']}:src/runtime.ts"], cwd=Path(__file__).resolve().parents[2], text=True)
    assert re.search(rf'\bconst SEMANTICS = {expected_semantics};', source), 'expected version not in frozen source'
    before = json.loads((bp / 'seed.state.json').read_text())
    after = json.loads((ap / 'upgrade.state.json').read_text())
    raw = json.loads((ap / 'upgrade.result.json').read_text())
    result = check(before, after, raw, expected_semantics)
    controls = {}
    for mode in ['wrong-alias', 'expanded-options', 'changed-port', 'invented-probe', 'wrong-inference-version']:
        altered, wires = copy.deepcopy(after), copy.deepcopy(raw)
        cap = capability(altered)
        if mode == 'wrong-alias':
            cap['invoke']['continuity'][0]['behaviour'] = 'unproven-operation'
        elif mode == 'expanded-options':
            cap['invoke']['options']['allowed'].append({'flags': ['--unproven'], 'arg': False})
        elif mode == 'changed-port':
            cap['inputs'][0]['type'] = 'unproven:input'
        elif mode == 'invented-probe':
            wires['wires'] = [w for w in wires['wires'] if w['opts'].get('purpose') != 'investigation']
        else:
            altered['semantics'] = expected_semantics + 1
        try:
            check(before, altered, wires, expected_semantics)
        except (AssertionError, StopIteration):
            controls[mode] = 'rejected'
        else:
            raise AssertionError(f'accepted {mode}')
    print(json.dumps({'verdict': 'PASS', 'scope': 'bounded same-binary exposed inference migration; no universal semantics or independent-author claim',
                      'expectedSemantics': expected_semantics, 'continuity': result, 'negativeControls': controls}, indent=2))

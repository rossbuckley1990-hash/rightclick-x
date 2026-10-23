"""Separate byte and contract comparison. Stdlib only; not independent-author review."""
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys

REPO = Path(__file__).resolve().parents[2]


def size(x):
    return len(json.dumps(x, ensure_ascii=False, separators=(',', ':')).encode())


def output(reply):
    r = reply['result']
    assert r['isError'] is False
    assert json.loads(r['content'][0]['text']) == r['structuredContent']
    return r['structuredContent']


def check(before, after):
    assert before['stateSha256'] == after['stateSha256']
    assert before['programs'] == after['programs']
    for capture in [before, after]:
        assert capture['events'] == [] and capture['runs'] == 0 and capture['graphUnchanged'] is True
        for key in ['initialize', 'tools']:
            assert json.loads(capture[key + 'Wire']) == capture[key]
        for path, digest in capture['sourceHashes'].items():
            raw = subprocess.check_output(['git', 'show', f"{capture['commit']}:{path}"], cwd=REPO)
            assert hashlib.sha256(raw).hexdigest() == digest, path
    bt, at = [c['tools']['result']['tools'] for c in [before, after]]
    assert len(bt) == len(at) == 13 and [t['name'] for t in bt] == [t['name'] for t in at]
    for b, a in zip(bt, at):
        assert b['annotations'] == a['annotations'], 'changed tool effect/approval hints'
    assert [c['id'] for c in before['capabilities']] == [c['id'] for c in after['capabilities']]
    rows = []
    for b, a in zip(before['capabilities'], after['capabilities']):
        for entry in [b, a]:
            for key in ['brief', 'full']:
                assert json.loads(entry[key + 'Wire']) == entry[key]
        old, full, brief = output(b['full']), output(a['full']), output(a['brief'])
        assert old == full, 'full detail changed'
        assert brief['details'] == {'tool': 'context_explain', 'args': {'id': a['id'], 'detail': 'full'}}
        expected_cap = copy.deepcopy(full['capability'])
        if expected_cap['invoke']['kind'] == 'cli':
            expected_cap['invoke'].pop('examples', None)
            expected_cap['invoke'].pop('continuity', None)
        assert brief['capability'] == expected_cap, 'invocation or port contract changed'
        assert brief['execution'] == full['execution'], 'restriction lost'
        card, contract = full['card'], full['card']['contract']
        for key in ['status', 'outputSemantics', 'preconditions', 'verificationObligations', 'failureBehaviour', 'invalidatedWhen', 'counterexamples', 'reproduction']:
            assert brief['contract'].get(key) == contract.get(key), ('contract', key)
        for key in ['dependencies', 'semanticAssumptions', 'executionPlan', 'sideEffects', 'authority', 'verification', 'limitations']:
            assert brief['contract'][key] == card[key], ('card', key)
        assert brief['evidence']['claims'] == contract['behaviouralEvidence']
        assert brief['evidence']['sourceEnvironment'] == contract['sourceEnvironment']
        assert brief['evidence']['provenance'] == card['provenance']
        assert brief['exampleArgs'] == full['exampleArgs']
        assert len(a['brief']['result']['content'][0]['text'].encode()) == size(brief)
        rows.append({'id': a['id'], 'beforeWireBytes': len(b['briefWire'].encode()), 'afterWireBytes': len(a['briefWire'].encode()),
                     'beforePayloadBytes': size(output(b['brief'])), 'afterPayloadBytes': size(brief)})
    ib, ia = [len(c['initialize']['result']['instructions'].encode()) for c in [before, after]]
    return {'capabilities': rows, 'explanationWireBytesBefore': sum(r['beforeWireBytes'] for r in rows),
            'explanationWireBytesAfter': sum(r['afterWireBytes'] for r in rows),
            'initializationWireBytes': {'before': len(before['initializeWire'].encode()), 'after': len(after['initializeWire'].encode())},
            'initializationInstructionBytes': {'before': ib, 'after': ia},
            'toolsListWireBytes': {'before': len(before['toolsWire'].encode()), 'after': len(after['toolsWire'].encode())},
            'clientPrefixReplicationProjection': {'copies': 13, 'beforeBytes': 13 * ib, 'afterBytes': 13 * ia,
              'scope': 'projection from the historical client behavior; not a new observed client trace'}}


if __name__ == '__main__':
    before, after = [json.loads(Path(p).read_text()) for p in sys.argv[1:]]
    result = check(before, after)
    controls = {}
    for kind in ['options', 'authority', 'verification', 'evidence']:
        bad = copy.deepcopy(after)
        record = bad['capabilities'][0]['brief']['result']
        brief = record['structuredContent']
        if kind == 'options':
            brief['capability']['invoke']['args'].append('--unproven')
        elif kind == 'authority':
            brief['contract']['authority'] = {}
        elif kind == 'verification':
            brief['contract']['verificationObligations'] = 'no checks needed'
        else:
            brief['contract']['status'] = 'verified'
        record['content'][0]['text'] = json.dumps(brief, ensure_ascii=False, separators=(',', ':'))
        bad['capabilities'][0]['briefWire'] = json.dumps(bad['capabilities'][0]['brief'], ensure_ascii=False, separators=(',', ':'))
        try:
            check(before, bad)
        except AssertionError:
            controls[kind] = 'rejected'
        else:
            raise AssertionError(f'accepted {kind}')
    print(json.dumps({'verdict': 'PASS', 'scope': 'same-state disclosure fidelity and wire bytes only; no model-economic advantage established',
                      'measurement': result, 'negativeControls': controls}, indent=2))

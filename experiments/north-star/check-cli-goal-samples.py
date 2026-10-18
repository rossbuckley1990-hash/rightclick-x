"""Separate raw checker; stdlib only, no product/scorer imports. Same-author, not external review."""
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys

REPO = Path(__file__).resolve().parents[2]
NAMES = ['seed', 'warm-direct', 'warm-goal', 'compatible-direct', 'reused-direct', 'compatible-goal', 'reused-goal',
         'revoked-investigation-direct', 'revoked-investigation-goal', 'revoked-execution-direct', 'revoked-execution-goal',
         'incompatible-direct', 'incompatible-goal', 'removed-direct', 'removed-goal', 'returned-without-learn', 'returned-after-learn', 'upgrade', 'upgraded-reuse']
INPUTS = {'seed': '["seed",1,true]', 'warm': '["warm",2,null]', 'compatible': '["compatible",3,false]',
          'reused': '["reused",4,true]', 'revoked': '["revoked",5]', 'incompatible': '["incompatible",6]',
          'removed': '["removed",7]', 'returned-without-learn': '["returned",8]',
          'returned-after-learn': '["returned",9]', 'upgrade': '["upgrade",10]', 'upgraded-reuse': '["upgraded-reuse",11]'}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def load(directory):
    p = Path(directory)
    names = [c['name'] for c in json.loads((p / 'cases.json').read_text())]
    return {'manifest': json.loads((p / 'manifest.json').read_text()),
            'cases': json.loads((p / 'cases.json').read_text()),
            'rows': {name: json.loads((p / f'{name}.result.json').read_text()) for name in names},
            'states': {name: (p / f'{name}.state.json').read_bytes() for name in names}}


def check(data, after):
    m, rows = data['manifest'], data['rows']
    for revision, hashes in [(m['commit'], m['sourceHashes']), (m['harnessCommit'], m['harnessHashes'])]:
        for path, digest in hashes.items():
            raw = subprocess.check_output(['git', 'show', f'{revision}:{path}'], cwd=REPO)
            assert sha(raw) == digest, (revision, path)
    assert m['network'] == {'blockPrivate': True, 'origins': []}
    assert m['compatible'] == '#!/bin/sh\nexec /usr/bin/json_xs "$@"\n'
    assert m['incompatible'] == '#!/bin/sh\n/usr/bin/json_xs "$@" | /usr/bin/rev\n'
    if not after:
        assert [c['name'] for c in data['cases']] == ['seed']
        r = rows['seed']
        assert r['cfg']['input'] == INPUTS['seed']
        assert r['network'] == [] and r['investigations'] == [m['program']]
        assert r['response']['plans'] == [] and not r['response'].get('executed')
        assert 'unsupported' in r['cap']['tags']
        assert all(w['opts']['purpose'] == 'investigation' for w in r['wires'])
        assert len({e['stdin'] for e in r['cap']['invoke']['examples']}) == 1
        assert r['stateSha256'] == sha(data['states']['seed'])
        return {'commit': m['commit'], 'status': 'blocked', 'phase': 'seed-publication', 'probes': len(r['wires'])}
    assert [c['name'] for c in data['cases']] == NAMES
    assert len({r['pid'] for r in rows.values()}) == len(NAMES), 'not fresh processes'
    summary = []
    unmet = []
    original_goal = json.loads(data['states']['seed'])['published'][0]
    assert original_goal['slug'] == 'repair-pretty-json' and original_goal['have'] == {'json': 'json'}
    assert original_goal['origins'] == [] and original_goal['want'] == 'text'
    for case in data['cases']:
        name = case['name']
        r = rows[name]
        assert r['cfg']['input'] == INPUTS[name if name in INPUTS else name.split('-')[0]], (name, 'substituted task input')
        target = m['migration']['program'] if name in ['upgrade', 'upgraded-reuse'] else m['program']
        assert r['cfg']['program'] == target and r['network'] == []
        assert r['sandbox'] in ['macos-sandbox-exec', 'linux-bwrap']
        assert r['stateSha256'] == sha(data['states'][name])
        state = json.loads(data['states'][name])
        if name not in ['upgrade', 'upgraded-reuse']:
            goal = next(g for g in state['published'] if g['slug'] == original_goal['slug'])
            for key in ['anchors', 'have', 'want', 'through', 'verify', 'origins']:
                assert goal[key] == original_goal[key], (name, 'saved goal contract changed', key)
        else:
            assert state['published'] == [], 'upgrade invented a goal'
        if name != 'seed':
            parent = 'compatible-direct' if name == 'reused-direct' else 'compatible-goal' if name == 'reused-goal' else 'removed-goal' if name.startswith('returned-') else 'upgrade' if name == 'upgraded-reuse' else 'seed'
            expected_state = m['migration']['stateSha256'] if name == 'upgrade' else sha(data['states'][parent])
            assert r['cfg']['inputStateSha256'] == expected_state, (name, 'wrong retained state')
        assert r['operationMs'] >= 0 and case['childMs'] >= r['operationMs']
        assert r['authority'] == {
            'investigate': [] if name.startswith('revoked-investigation-') else [target],
            'execute': [] if name.startswith('revoked-execution-') else [target]}
        assert all(p == target for p in r['investigations'])
        executions = [w for w in r['wires'] if w['opts']['purpose'] == 'execution']
        probes = [w for w in r['wires'] if w['opts']['purpose'] == 'investigation']
        assert len(executions) + len(probes) == len(r['wires'])
        for w in r['wires']:
            assert w['before'] == w['after'] and w['before']
            assert not w['result']['timedOut'] and not w['result']['truncated'] and not w['result'].get('limit')
            if w['program'] == '/usr/bin/man':
                assert w['opts']['purpose'] == 'investigation' and w['args'] == ['-P', 'cat', 'json_xs']
                assert not w['opts'].get('stdin') and not w['opts'].get('files')
                assert w['before']['real'] == '/usr/bin/man'
                continue
            assert w['program'] == target
            stage = 'original' if name in ['seed', 'upgrade', 'upgraded-reuse'] or name.startswith('warm-') else 'incompatible' if name.startswith('incompatible-') else 'compatible'
            expected_hash = m['original']['sha256'] if stage == 'original' else sha(m[stage].encode())
            assert w['before']['sha256'] == expected_hash, (name, 'wrong program bytes')
        response = r['response']['executed'] if name == 'seed' else r['response']
        succeeds = name in ['seed', 'warm-direct', 'warm-goal', 'returned-after-learn', 'upgrade', 'upgraded-reuse'] or after and name.startswith(('compatible-', 'reused-'))
        # Automatic migration remains a requirement, not a passing refusal score.
        # Report conservative refusals separately while checking that they dispatch nothing.
        if name in ['upgrade', 'upgraded-reuse'] and response['status'] == 'failed':
            assert 'changed meaning' in response['error']
            unmet.append({'case': name, 'required': 'completed', 'observed': 'failed', 'reason': 'old operation equivalence not re-established across inference versions'})
            succeeds = False
        assert response['status'] == ('completed' if succeeds else 'failed'), (name, response.get('error'))
        assert response['verification']['status'] != 'verified', 'structural checks are not independent witnesses'
        assert len(executions) == (1 if succeeds else 0), (name, 'wrong task dispatch count')
        if succeeds:
            w = executions[0]
            assert w['args'] == [] and not w['opts'].get('files')
            assert w['opts']['stdin'] == r['cfg']['input']
            assert w['result']['code'] == 0
            assert response['output'] == w['result']['stdout']
            assert json.loads(response['output']) == json.loads(r['cfg']['input']), name
            assert '\n  ' in response['output'], 'pretty-print requirement missing'
            assert response['verification']['status'] == 'checked'
        investigate = name in ['seed', 'returned-after-learn', 'upgrade'] or after and name.startswith(('compatible-', 'incompatible-'))
        assert len(r['investigations']) == (1 if investigate else 0), name
        assert bool(probes) == investigate, (name, 'unexpected probes')
        if after and name.startswith('compatible-'):
            assert 'drift' in json.dumps(response).lower()
        if after and name.startswith('incompatible-'):
            assert 'equivalent' in json.dumps(response) or 'anchor' in json.dumps(response)
        if name.startswith('removed-'):
            assert (r['finalCapabilities'] == []) == after
        if name == 'returned-without-learn':
            assert 'unresolved required anchor' in response['error']
        if name == 'seed':
            assert 'unsupported' not in r['cap']['tags']
            assert len({e['stdin'] for e in r['cap']['invoke']['examples']}) >= 2
        summary.append({'name': name, 'status': response['status'], 'investigations': len(r['investigations']),
                        'probes': len(probes), 'executions': len(executions),
                        'operationMs': r['operationMs'], 'childMs': case['childMs']})
    return {'commit': m['commit'], 'cases': summary, 'unmetRequirements': unmet, 'verdict': 'PARTIAL' if unmet else 'PASS'}


if __name__ == '__main__':
    assert len(sys.argv) == 3, 'provide BEFORE_DIR AFTER_DIR'
    before, after = [load(p) for p in sys.argv[1:]]
    assert before['manifest']['harnessHashes'] == after['manifest']['harnessHashes']
    assert before['manifest']['original'] == after['manifest']['original']
    assert after['manifest']['migration']['commit'] == before['manifest']['commit']
    assert after['manifest']['migration']['program'] == before['manifest']['program']
    assert after['manifest']['migration']['stateSha256'] == sha(before['states']['seed'])
    assert after['rows']['upgrade']['cfg']['inputStateSha256'] == sha(before['states']['seed'])
    assert after['rows']['upgraded-reuse']['cfg']['inputStateSha256'] == sha(after['states']['upgrade'])
    assert json.loads(before['states']['seed'])['semantics'] == 22
    assert json.loads(after['states']['upgrade'])['semantics'] == 25
    manuals = [w['before']['sha256'] for data in [before, after] for r in data['rows'].values()
               for w in r['wires'] if w['program'] == '/usr/bin/man']
    assert manuals and len(set(manuals)) == 1, 'manual helper identity changed'
    assert before['rows']['seed']['cfg']['input'] == after['rows']['seed']['cfg']['input']
    result = {'scope': 'exposed saved-goal development; previously blocked seed; no agent economics, holdout or independent-author claim',
              'before': check(before, False), 'after': check(after, True)}
    controls = {}
    for kind in ['wrong-output', 'dispatch-on-refusal', 'hidden-network', 'missing-authority', 'substituted-input', 'repinned-goal']:
        forged = copy.deepcopy(after)
        if kind == 'wrong-output':
            r = forged['rows']['compatible-direct']
            r['response']['output'] = '[\n   "wrong"\n]\n'
            next(w for w in r['wires'] if w['opts']['purpose'] == 'execution')['result']['stdout'] = r['response']['output']
        elif kind == 'dispatch-on-refusal':
            r = forged['rows']['incompatible-direct']
            wire = copy.deepcopy(next(w for w in forged['rows']['compatible-direct']['wires'] if w['opts']['purpose'] == 'execution'))
            wire['before'] = wire['after'] = copy.deepcopy(next(w['before'] for w in r['wires'] if w['program'] == after['manifest']['program']))
            r['wires'].append(wire)
        elif kind == 'hidden-network':
            forged['rows']['compatible-direct']['network'].append('https://unapproved.test')
        elif kind == 'missing-authority':
            forged['rows']['revoked-execution-direct']['authority']['execute'] = [after['manifest']['program']]
        elif kind == 'substituted-input':
            r = forged['rows']['compatible-direct']
            r['cfg']['input'] = '["substituted",3,false]'
            wire = next(w for w in r['wires'] if w['opts']['purpose'] == 'execution')
            wire['opts']['stdin'] = r['cfg']['input']
            wire['result']['stdout'] = r['response']['output'] = '[\n   "substituted",\n   3,\n   false\n]\n'
        else:
            state = json.loads(forged['states']['compatible-goal'])
            state['published'][0]['anchors'][0]['operation'] = 'silently-repinned-operation'
            forged['states']['compatible-goal'] = json.dumps(state).encode()
            forged['rows']['compatible-goal']['stateSha256'] = sha(forged['states']['compatible-goal'])
        try:
            check(forged, True)
        except AssertionError:
            controls[kind] = 'rejected'
        else:
            raise AssertionError(f'accepted {kind}')
    result['negativeControls'] = controls
    result['artifactHashes'] = {str(Path(directory) / path.name): sha(path.read_bytes())
                               for directory in sys.argv[1:] for path in sorted(Path(directory).iterdir()) if path.is_file()}
    print(json.dumps(result, indent=2))

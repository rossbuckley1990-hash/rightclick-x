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
         'incompatible-direct', 'incompatible-goal', 'removed-direct', 'removed-goal', 'returned-without-learn', 'returned-after-learn']


def sha(data):
    return hashlib.sha256(data).hexdigest()


def load(directory):
    p = Path(directory)
    return {'manifest': json.loads((p / 'manifest.json').read_text()),
            'cases': json.loads((p / 'cases.json').read_text()),
            'rows': {name: json.loads((p / f'{name}.result.json').read_text()) for name in NAMES},
            'states': {name: (p / f'{name}.state.json').read_bytes() for name in NAMES}}


def check(data, after):
    m, rows = data['manifest'], data['rows']
    for revision, hashes in [(m['commit'], m['sourceHashes']), (m['harnessCommit'], m['harnessHashes'])]:
        for path, digest in hashes.items():
            raw = subprocess.check_output(['git', 'show', f'{revision}:{path}'], cwd=REPO)
            assert sha(raw) == digest, (revision, path)
    assert m['network'] == {'blockPrivate': True, 'origins': []}
    assert m['compatible'] == '#!/bin/sh\nexec /usr/bin/json_xs "$@"\n'
    assert m['incompatible'] == '#!/bin/sh\n/usr/bin/json_xs "$@" | /usr/bin/rev\n'
    assert [c['name'] for c in data['cases']] == NAMES
    assert len({r['pid'] for r in rows.values()}) == len(NAMES), 'not fresh processes'
    summary = []
    for case in data['cases']:
        name = case['name']
        r = rows[name]
        assert r['cfg']['program'] == m['program'] and r['network'] == []
        assert r['sandbox'] in ['macos-sandbox-exec', 'linux-bwrap']
        assert r['stateSha256'] == sha(data['states'][name])
        assert r['operationMs'] >= 0 and case['childMs'] >= r['operationMs']
        assert r['authority'] == {
            'investigate': [] if name.startswith('revoked-investigation-') else [m['program']],
            'execute': [] if name.startswith('revoked-execution-') else [m['program']]}
        assert all(p == m['program'] for p in r['investigations'])
        executions = [w for w in r['wires'] if w['opts']['purpose'] == 'execution']
        probes = [w for w in r['wires'] if w['opts']['purpose'] == 'investigation']
        assert len(executions) + len(probes) == len(r['wires'])
        for w in r['wires']:
            assert w['program'] == m['program'] and w['before'] == w['after'] and w['before']
            assert not w['result']['timedOut'] and not w['result']['truncated'] and not w['result'].get('limit')
            stage = 'original' if name == 'seed' or name.startswith('warm-') else 'incompatible' if name.startswith('incompatible-') else 'compatible'
            expected_hash = m['original']['sha256'] if stage == 'original' else sha(m[stage].encode())
            assert w['before']['sha256'] == expected_hash, (name, 'wrong program bytes')
        response = r['response']['executed'] if name == 'seed' else r['response']
        succeeds = name in ['seed', 'warm-direct', 'warm-goal', 'returned-after-learn'] or after and name.startswith(('compatible-', 'reused-'))
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
        investigate = name in ['seed', 'returned-after-learn'] or after and name.startswith(('compatible-', 'incompatible-'))
        assert len(r['investigations']) == (1 if investigate else 0), name
        assert bool(probes) == investigate, (name, 'unexpected probes')
        if after and name.startswith('compatible-'):
            assert 'drift' in json.dumps(response).lower()
        if after and name.startswith('incompatible-'):
            assert 'equivalent' in json.dumps(response) or 'anchor' in json.dumps(response)
        if name.startswith('removed-'):
            assert (r['finalCapabilities'] == []) == after
        if after and name == 'returned-without-learn':
            assert 'unresolved required anchor' in response['error']
        summary.append({'name': name, 'status': response['status'], 'investigations': len(r['investigations']),
                        'probes': len(probes), 'executions': len(executions),
                        'operationMs': r['operationMs'], 'childMs': case['childMs']})
    return {'commit': m['commit'], 'cases': summary}


if __name__ == '__main__':
    assert len(sys.argv) == 3, 'provide BEFORE_DIR AFTER_DIR'
    before, after = [load(p) for p in sys.argv[1:]]
    assert before['manifest']['harnessHashes'] == after['manifest']['harnessHashes']
    assert before['manifest']['original'] == after['manifest']['original']
    for name in NAMES:
        assert before['rows'][name]['cfg']['input'] == after['rows'][name]['cfg']['input']
    result = {'scope': 'exposed deterministic development; no agent economics or independent-author claim',
              'before': check(before, False), 'after': check(after, True)}
    controls = {}
    for kind in ['wrong-output', 'dispatch-on-refusal', 'hidden-network', 'missing-authority']:
        forged = copy.deepcopy(after)
        if kind == 'wrong-output':
            r = forged['rows']['compatible-direct']
            r['response']['output'] = '[\n   "wrong"\n]\n'
            next(w for w in r['wires'] if w['opts']['purpose'] == 'execution')['result']['stdout'] = r['response']['output']
        elif kind == 'dispatch-on-refusal':
            forged['rows']['incompatible-direct']['wires'].append(next(w for w in forged['rows']['compatible-direct']['wires'] if w['opts']['purpose'] == 'execution'))
        elif kind == 'hidden-network':
            forged['rows']['compatible-goal']['network'].append('https://unapproved.test')
        else:
            forged['rows']['revoked-execution-goal']['authority']['execute'] = [after['manifest']['program']]
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

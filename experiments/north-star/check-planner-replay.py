"""Separate exact-plan/output checker. Same author; not independent-author review."""
import copy
import hashlib
import json
from pathlib import Path
import statistics
import subprocess
import sys

REPO = Path(__file__).resolve().parents[2]
EXPECTED = 'Se esperan nublado cielos con una máxima de 19°C y una suave brisa hoy.'


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()


def plans(before, after):
    assert len(before['rows']) == len(after['rows']) == 256
    assert [(r['seed'], r['q']) for r in before['rows']] == [(i, q) for i in range(64) for q in range(4)]
    for b, a in zip(before['rows'], after['rows']):
        assert (b['seed'], b['q'], b['query'], b['plans']) == (a['seed'], a['q'], a['query'], a['plans']), (b['seed'], b['q'])
    return sum(bool(r['plans']) for r in after['rows'])


def publication(result):
    assert result['publications'] == 25
    for field in ['rows', 'reuse']:
        assert [r['index'] for r in result[field]] == list(range(25))
    for row in result['rows']:
        request, response = row['request'], row['result']
        assert request == {'have': {'place': 'Lima', 'language': 'es'}, 'want': 'text', 'intent': 'weather translated', 'run': True, 'publish': f"weather-{row['index']}", 'verify': [{'op': 'contains', 'value': '19°C'}]}
        assert response['published'] == {'id': f"goal:weather-{row['index']}", 'slug': f"weather-{row['index']}", 'path': f"/x/weather-{row['index']}", 'trust': 'checked'}
        run = response['executed']
        assert run['status'] == 'completed' and run['output'] == EXPECTED
        assert run['contract'] == {'status': 'satisfied', 'violations': [], 'assurance': 'predicate-checked'}
        assert run['verification']['status'] == 'checked' and not run['attempts']
        assert run['verification']['results'] == [{'predicate': {'op': 'contains', 'value': '19°C'}, 'ok': True, 'actual': EXPECTED}]
    for row in result['reuse']:
        run = row['result']
        assert run['capability'] == f"goal:weather-{row['index']}"
        assert run['status'] == 'completed' and run['output'] == EXPECTED
        assert run['verification']['status'] == 'checked' and not run['attempts']
        receipt = dict(run['receipt'])
        assert receipt.pop('hash') == digest(canonical(receipt))
        assert receipt['inputDigest'] == digest(canonical({'place': 'Lima', 'language': 'es'}))
        assert receipt['outputDigest'] == digest(canonical(EXPECTED))
        assert receipt['verification'] == 'checked' and receipt['status'] == 'completed'


def main(base):
    checked = set()
    manifests = []
    def capture(label):
        manifest = json.loads((base/label/'manifest.json').read_text())
        process = json.loads((base/f'{label}-process.json').read_text())
        assert process['exitCode'] == 0 and process['stopped'] is False
        for path, sha in {**manifest['sourceHashes'], manifest['harnessPath']: manifest['harnessSha256']}.items():
            revision = manifest['harnessRevision'] if path == manifest['harnessPath'] else manifest['commit']
            key = revision, path, sha
            if key not in checked:
                raw = subprocess.check_output(['git', 'show', f'{revision}:{path}'], cwd=REPO)
                assert digest(raw) == sha, key
                checked.add(key)
        manifests.append(manifest)
        return json.loads((base/label/'results.json').read_text())
    timings = []
    total = 0
    for pair in range(1, 7):
        bp, ap = [capture(f'paired-plans-{pair}-{arm}') for arm in ['before', 'after']]
        total += len(ap['rows'])
        nonempty = plans(bp, ap)
        pub = [capture(f'paired-publish-{pair}-{arm}') for arm in ['before', 'after']]
        for p in pub:
            publication(p)
        timings.append({'pair': pair, 'plansMs': [sum(r['ms'] for r in x['rows']) for x in [bp, ap]],
                        'publishMs': [sum(r['ms'] for r in x['rows']) for x in pub],
                        'reuseMs': [sum(r['ms'] for r in x['reuse']) for x in pub],
                        'lifecycleMs': [x['ms'] for x in pub]})
    before_sources, after_sources = manifests[0]['sourceHashes'], manifests[1]['sourceHashes']
    assert before_sources.keys() == after_sources.keys()
    assert [p for p in before_sources if before_sources[p] != after_sources[p]] == ['src/core/planner.ts']
    for m in manifests:
        assert m['sourceHashes'] == (before_sources if m['commit'] == manifests[0]['commit'] else after_sources)
        assert (m['harnessSha256'], m['node'], m['platform'], m['arch']) == tuple(manifests[0][key] for key in ['harnessSha256', 'node', 'platform', 'arch'])
    controls = {}
    for name in ['binding', 'wrong-output', 'false-verification', 'missing-publication']:
        changed = copy.deepcopy(ap if name == 'binding' else pub[1])
        if name == 'binding':
            row = next(r for r in changed['rows'] if r['plans'])
            row['plans'][0]['steps'][0]['bindings'][0]['from'] = '$in.not-authorised'
        elif name == 'wrong-output':
            changed['rows'][0]['result']['executed']['output'] = 'incorrect'
        elif name == 'false-verification':
            changed['reuse'][0]['result']['verification']['status'] = 'verified'
        else:
            changed['rows'].pop()
        try:
            plans(bp, changed) if name == 'binding' else publication(changed)
        except AssertionError:
            controls[name] = 'rejected'
        else:
            raise AssertionError(f'accepted corruption: {name}')
    medians = {key: {'before': statistics.median(r[key][0] for r in timings), 'after': statistics.median(r[key][1] for r in timings),
                     'pairedSpeedupMedian': statistics.median(r[key][0]/r[key][1] for r in timings),
                     'pairedSpeedupRange': [min(r[key][0]/r[key][1] for r in timings), max(r[key][0]/r[key][1] for r in timings)]}
               for key in ['plansMs', 'publishMs', 'reuseMs', 'lifecycleMs']}
    print(json.dumps({'verdict': 'PASS', 'scope': 'same-author separate checker; development microbenchmark, not independent review or agent economics',
                      'exactPlanComparisons': total, 'distinctQueries': 256, 'nonemptyPerReplay': nonempty, 'correctPublicationAndReuseOutputs': 600,
                      'sourceArtifactsChecked': len(checked), 'negativeControls': controls, 'timings': timings, 'medians': medians}, indent=2))


if __name__ == '__main__':
    main(Path(sys.argv[1]))

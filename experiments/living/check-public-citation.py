"""Separate task-specific public readback; not a provider adapter or independent author.

Learner outputs never select the oracle URL or the expected identifier.
"""
import json
import pathlib
import sys
import urllib.parse
import urllib.request

evidence, destination = map(pathlib.Path, sys.argv[1:])
destination.mkdir(parents=True, exist_ok=False)
provenance = json.loads((evidence / 'provenance.json').read_text())
entry_id = provenance['config']['goals'][0]['have']['entry_id']
if not isinstance(entry_id, str) or not entry_id.isalnum() or len(entry_id) != 4:
    raise ValueError('expected one explicit four-character structure identifier')


def get(url, name):
    request = urllib.request.Request(url, headers={'User-Agent': 'RightClick-X-readonly-outcome-check/0.1', 'Accept': 'application/json'})
    with urllib.request.urlopen(request, timeout=30) as response:
        data = response.read(8 * 1024 * 1024 + 1)
        if len(data) > 8 * 1024 * 1024:
            raise ValueError('oracle response too large')
        (destination / (name + '.json')).write_bytes(data)
        return json.loads(data)


record = get('https://data.rcsb.org/rest/v1/core/entry/' + entry_id, 'structure')
expected_doi = record['rcsb_primary_citation']['pdbx_database_id_DOI']
expected = get('https://api.crossref.org/works/' + urllib.parse.quote(expected_doi, safe=''), 'publication')['message']
candidate = json.loads((evidence / 'goal-0.json').read_text())
output = candidate.get('executed', {}).get('output')
outputs = output if isinstance(output, list) else [output]
messages = [row.get('message', {}) for row in outputs if isinstance(row, dict)]
checks = {
    'exactlyOnePrimaryPublication': len(messages) == 1,
    'primaryCitationDOI': len(messages) == 1 and str(messages[0].get('DOI', '')).lower() == expected_doi.lower(),
    'title': len(messages) == 1 and messages[0].get('title') == expected.get('title'),
    'publisher': len(messages) == 1 and messages[0].get('publisher') == expected.get('publisher'),
}
result = {'scope': 'same-author separate implementation and fresh public readback; same underlying metadata sources, no independent author or business attestation', 'entryId': entry_id, 'expectedDOI': expected_doi, 'actualDOIs': [m.get('DOI') for m in messages], 'checks': checks, 'status': 'PASS' if all(checks.values()) else 'FAIL'}
(destination / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result))
sys.exit(0 if result['status'] == 'PASS' else 1)

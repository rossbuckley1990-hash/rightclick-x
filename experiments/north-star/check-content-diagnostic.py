#!/usr/bin/env python3
"""Check exact input/output bytes and large integer truth independently of the TS parser.
Known development fixture; same author, separate implementation, no competitive claim.
"""
import json
import pathlib
import sys

report = json.loads(pathlib.Path(sys.argv[1]).read_text())
assert len(report['observations']) == 4
checks = []
for row in report['observations']:
    source = row['input']
    expected = source if isinstance(source, str) else json.dumps(source, separators=(',', ':'))
    assert row['wire']['stdin'] == expected, row['name'] + ': typed invocation changed input'
    assert row['rawWire']['stdin'] == expected, row['name'] + ': raw invocation changed input'
    assert row['rawResponse']['status'] == 'completed', row['name']
    assert row['rawResponse']['output'] == row['rawWire']['stdout'] == row['direct']['stdout'], row['name'] + ': output differs'
    assert row['rawResponse']['verification']['status'] == 'unverified', 'byte preservation is not independent verification'
    if row['name'] == 'integer-precision':
        assert json.loads(row['rawResponse']['output'])['account'] == 9007199254740993
        assert row['response']['status'] == 'failed' and row['response']['verification']['status'] == 'refuted'
        assert row['response'].get('output') is None
        assert row['response'].get('healing') is None, 'representation failure must not retry'
    else:
        assert row['response']['status'] == 'completed'
    checks.append({'case': row['name'], 'exactInput': True, 'exactOutput': True})
fresh = report['freshReuse']
assert fresh['investigations'] == 0
assert fresh['wire']['stdin'] == fresh['input']
assert fresh['response']['status'] == 'completed'
assert fresh['response']['output'] == fresh['wire']['stdout']
assert json.loads(fresh['response']['output'])['account'] == 9007199254740995
print(json.dumps({'scope': 'separate implementation checking development artifacts; not independent-author review', 'checks': checks, 'newRuntimeReuse': {'investigations': 0, 'exactLargeInteger': True}}, indent=2))

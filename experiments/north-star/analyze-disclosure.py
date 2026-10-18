"""Measure recorded client-visible disclosure, without executing recorded agent code.
Bytes are not model tokens or causal latency estimates. Historical scores stay unchanged.
"""
import collections
import hashlib
import json
import os
from pathlib import Path
import re
import sys


def size(value):
    return len(json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode())


def analyze(directory):
    root = Path(directory).resolve()
    result = json.loads((root / 'results.json').read_text())
    rows, hashes = [], {}
    for session in result['sessions']:
        path = root / 'results.json.attempts' / session['attemptId'] / 'agent-tools.jsonl'
        raw = path.read_bytes()
        hashes[str(path)] = hashlib.sha256(raw).hexdigest()
        events = [json.loads(line)['payload'] for line in raw.splitlines() if line]
        calls = {e['call_id']: e for e in events if e['type'] == 'custom_tool_call'}
        record = {'key': session['key'], 'arm': session['arm'], 'phase': session['phase'],
                  'reportedTokens': session['tokens'], 'seconds': session['seconds'],
                  'visibleTextBytes': 0, 'catalogues': [], 'responses': []}
        for event in events:
            if event['type'] != 'custom_tool_call_output':
                continue
            call = calls[event['call_id']]
            names = re.findall(r'tools\.(mcp__[\w]+)\s*\(', call['input'])
            for block in event['output']:
                if block.get('type') != 'input_text':
                    continue
                text = block['text']
                record['visibleTextBytes'] += len(text.encode())
                try:
                    value = json.loads(text)
                except ValueError:
                    continue
                if isinstance(value, list) and value and all(isinstance(v, dict) and 'name' in v and 'description' in v for v in value):
                    prefix = os.path.commonprefix([v['description'] for v in value])
                    record['catalogues'].append({'tools': len(value), 'visibleBytes': len(text.encode()),
                        'sharedPrefixBytes': len(prefix.encode()), 'repeatedPrefixBytesBeyondOne': len(prefix.encode()) * (len(value) - 1)})
                elif isinstance(value, dict) and 'structuredContent' in value:
                    structured = value['structuredContent']
                    encoded = [b['text'] for b in value.get('content', []) if b.get('type') == 'text']
                    text_value = json.loads(encoded[0]) if len(encoded) == 1 else None
                    equivalent = text_value == structured or structured == {'result': text_value}
                    response = {'candidateToolsInCall': names, 'visibleEnvelopeBytes': len(text.encode()),
                        'structuredBytes': size(structured), 'textJsonBytes': len(encoded[0].encode()) if len(encoded) == 1 else None,
                        'equivalentRepresentations': equivalent}
                    if isinstance(structured, dict) and isinstance(structured.get('capability'), dict) and ('card' in structured or 'contract' in structured):
                        response['explanationFields'] = {k: size(v) for k, v in structured.items()}
                    if isinstance(structured, dict) and 'plans' in structured:
                        response['composeExecuted'] = 'executed' in structured
                        response['plans'] = len(structured['plans'])
                    record['responses'].append(response)
        rows.append(record)
    groups = {}
    for arm in ['A', 'B', 'C', 'D']:
        chosen = [r for r in rows if r['arm'] == arm and r['phase'] == 'reuse']
        groups[arm] = {'warmSessions': len(chosen), 'visibleTextBytes': sum(r['visibleTextBytes'] for r in chosen),
            'catalogueBytes': sum(c['visibleBytes'] for r in chosen for c in r['catalogues']),
            'repeatedCataloguePrefixBytesBeyondOne': sum(c['repeatedPrefixBytesBeyondOne'] for r in chosen for c in r['catalogues']),
            'explanationEnvelopeBytes': sum(c['visibleEnvelopeBytes'] for r in chosen for c in r['responses'] if 'explanationFields' in c),
            'composeResponsesWithoutExecution': sum(not c['composeExecuted'] for r in chosen for c in r['responses'] if 'composeExecuted' in c)}
    return {'scope': 'raw recorded visible UTF-8 bytes, not tokens, cost savings, causal latency or an updated benchmark score',
        'sourceResultsSha256': hashlib.sha256((root / 'results.json').read_bytes()).hexdigest(),
        'warmGroups': groups, 'sessions': rows, 'rawHashes': hashes}


if __name__ == '__main__':
    print(json.dumps(analyze(sys.argv[1]), indent=2))

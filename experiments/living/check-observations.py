"""Post-hoc cross-artifact checker, separate implementation, same author.
Checks consistency and receipt hashes, NOT provider business truth or signatures.
"""
import copy, hashlib, json, pathlib, sys
root=pathlib.Path(sys.argv[1])
state=json.loads((root/'browser-replay/runtime-state.json').read_text())
reload=json.loads((root/'fresh-process.json').read_text())
def verify(state,reload):
    entries=state['activity']['entries']
    assert len(entries)<=500
    assert all(a['seq']<b['seq'] for a,b in zip(entries,entries[1:]))
    assert len({e['id'] for e in entries})==len(entries)
    assert len({e['epoch'] for e in entries if e['kind']=='runtime.started'})==2
    compose=next(e for e in entries if e['kind']=='composition.finished' and 'goal:observed-weather' in e.get('subjects',[]))
    assert compose['status']=='completed' and compose['verification']=='checked'
    assert compose['predicates']==compose['predicatesPassed']==1 and compose['witnessesPassed']==0
    assert len(set(compose['providers']))==3 and len(compose['runs'])==3
    receipts=state['receipts']
    previous=receipts[0]['prev']
    for r in receipts:
        body={k:v for k,v in r.items() if k!='hash'}
        digest=hashlib.sha256(json.dumps(body,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
        assert r['prev']==previous and r['hash']==digest
        previous=r['hash']
    for run in compose['runs']:
        e=next(e for e in entries if e['kind']=='execution.finished' and run in e.get('runs',[]))
        r=next(r for r in receipts if r['runId']==run)
        assert e['receipt']==r['hash'] and e['status']==r['status']=='completed'
    assert any(e['kind']=='provider.forgotten' and 'mcp:skycast' in e.get('providers',[]) for e in entries)
    assert any(e['kind']=='capability.retired' for e in entries)
    c=reload['capability']
    assert c['states']['authority']['state']=='unknown'
    assert c['states']['assurance']['state']=='predicates-passed-on-run'
    assert c['states']['validity']['state']=='dependencies-changed'
    assert c['lastObservation']['id']==compose['id'] and reload['runs']==0
    assert len({e['epoch'] for e in reload['activity']['entries'] if e['kind']=='runtime.started'})==3
verify(state,reload)
controls=[]
for name in ['grant-inflation','receipt-tamper','missing-run','lost-withdrawal']:
    s,r=copy.deepcopy(state),copy.deepcopy(reload)
    if name=='grant-inflation': r['capability']['states']['authority']['state']='authorised'
    if name=='receipt-tamper': s['receipts'][0]['outputDigest']='0'*64
    if name=='missing-run': s['activity']['entries']=[e for e in s['activity']['entries'] if e['kind']!='execution.finished']
    if name=='lost-withdrawal': s['activity']['entries']=[e for e in s['activity']['entries'] if e['kind']!='provider.forgotten']
    try: verify(s,r)
    except (AssertionError,StopIteration): controls.append({'control':name,'rejected':True})
    else: raise AssertionError('negative control accepted: '+name)
print(json.dumps({'passed':True,'receipts':len(state['receipts']),'observations':len(state['activity']['entries']),'negativeControls':controls,'scope':'Same-author separate Python consistency checker, not independent business-outcome or authority verification'},indent=2))

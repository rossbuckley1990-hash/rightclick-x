import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PROBE_ATTEMPTS } from '../src/core/sandbox.ts';
import { sandboxGate } from './sandbox-gate.ts';
const {skip}=await sandboxGate();
// Linux tries both configured bwrap paths; macOS has one candidate.
const candidates=process.platform==='linux'?['/usr/bin/bwrap','/bin/bwrap'].filter(existsSync).length:1;

// The 30 s bound covers the probe's retry pauses on a loaded host; the probes themselves are bounded below.
function traced(script:string,mode:string,args:string[]=[]) {
  const dir=mkdtempSync(join(tmpdir(),'rcx-observer-')),file=join(dir,'result.json'),trace=join(dir,'trace');
  try {
    execFileSync(process.execPath,['--import',resolve('experiments/sandbox/trace-resources.mjs'),resolve(`experiments/sandbox/${script}`),file,...args],{
      timeout:30000,env:{...process.env,RCX_RESOURCE_TRACE:trace,RCX_RESOURCE_FAULT:mode},stdio:'pipe',
    });
    return {result:JSON.parse(readFileSync(file,'utf8')),events:readdirSync(trace).flatMap(f=>JSON.parse(readFileSync(join(trace,f),'utf8')).events)};
  } finally {rmSync(dir,{recursive:true,force:true})}
}
const probe=(mode:string,quick=false)=>traced('probe-observer-failure.ts',mode,quick?['quick']:[]);
const spawns=(events:any[])=>events.filter((e:any)=>e.kind==='spawn');

test('sandbox refuses availability when the resource observer fails', {skip},()=>{
  const p=probe('ps-error');
  assert.equal(p.result.sandbox,null);
  // All candidates must fail their availability probe before any workload is run. A lost
  // observation is retried, at most PROBE_ATTEMPTS runs per candidate, and only the probe runs.
  assert.equal(spawns(p.events).length,PROBE_ATTEMPTS*candidates,'only bounded availability probes were dispatched');
  assert.ok(spawns(p.events).every((e:any)=>e.probe),'every dispatched run was the availability probe');
});
test('sandbox rejects malformed resource snapshots instead of treating them as zero usage', {skip},()=>{
  assert.equal(probe('malformed').result.sandbox,null);
});
test('sandbox stops a workload after resource supervision is lost', {skip},()=>{
  const p=probe('after-probe-error');
  assert.ok(p.result.sandbox,'availability probe worked before the injected failure');
  assert.equal(p.result.result.limit,'supervision');
  assert.notEqual(p.result.result.code,0);
});
test('sandbox withholds output when an in-flight resource observation fails after child exit', {skip},()=>{
  const p=probe('late-error',true);
  assert.equal(p.result.result.limit,'supervision');
  assert.equal(p.result.result.stdout,'');
  assert.notEqual(p.result.result.code,0);
});
test('sandbox serialises slow resource observations instead of spawning overlapping polls', {skip},()=>{
  const p=probe('slow');
  assert.equal(p.result.result.code,0);
  let pending=0,maximum=0;
  for(const e of p.events){if(e.kind==='poll-start'){pending++;maximum=Math.max(maximum,pending)}if(e.kind==='poll-end')pending--}
  assert.equal(pending,0);
  assert.equal(maximum,1);
});

// ------------------------------------- a failed probe is not remembered unless the sandbox refused

test('one lost observation during the availability probe is retried, and the sandbox is available', {skip},()=>{
  const p=traced('probe-recovery.ts','ps-error-first-runs=1',['again']);
  const [first,second]=p.result.calls;
  assert.ok(first.sandbox,'one lost observation did not disable the sandbox');
  assert.deepEqual(first.attempts.map((a:any)=>[a.attempt,a.outcome,a.limit??null]),[[1,'transient','supervision'],[2,'ok',null]]);
  assert.equal(second.sandbox,first.sandbox);
  assert.equal(spawns(p.events).length,2,'a working sandbox is remembered, not probed again');
  assert.ok(spawns(p.events).every((e:any)=>e.probe));
});
test('a probe round lost entirely to transient failures fails closed, is not remembered, and the next call finds the sandbox', {skip},()=>{
  const lost=PROBE_ATTEMPTS*candidates;
  const p=traced('probe-recovery.ts',`ps-error-first-runs=${lost}`,['again']);
  const [first,second]=p.result.calls;
  assert.equal(first.sandbox,null,'a round with no passing attempt returns no sandbox');
  assert.equal(first.attempts.length,lost);
  assert.ok(first.attempts.every((a:any)=>a.outcome==='transient'&&a.limit==='supervision'));
  assert.ok(second.sandbox,'the transient failure did not disable the sandbox for the rest of the process');
  assert.deepEqual(second.attempts.map((a:any)=>a.outcome),['ok']);
  assert.equal(spawns(p.events).length,lost+1);
  assert.ok(spawns(p.events).every((e:any)=>e.probe),'nothing but probes ran');
});
test('a persistent observer failure returns null on every call, each after a bounded number of probes', {skip},()=>{
  const p=traced('probe-recovery.ts','ps-error',['again']);
  assert.equal(p.result.calls.length,2);
  for(const call of p.result.calls){
    assert.equal(call.sandbox,null);
    assert.equal(call.attempts.length,PROBE_ATTEMPTS*candidates);
    assert.ok(call.attempts.every((a:any)=>a.outcome==='transient'));
  }
  assert.equal(spawns(p.events).length,2*PROBE_ATTEMPTS*candidates,'each call is bounded');
  assert.ok(spawns(p.events).every((e:any)=>e.probe),'no workload ran without a sandbox');
});
test('a runtime that detects the host sandbox itself does not keep a transient probe failure', {skip},()=>{
  const lost=PROBE_ATTEMPTS*candidates;
  const p=traced('probe-recovery.ts',`ps-error-first-runs=${lost}`,['runtime']);
  assert.match(String(p.result.first.error),/unavailable: no sandbox/,'nothing is investigated while no probe has passed');
  assert.equal(p.result.first.cliCapabilities,0);
  assert.equal(p.result.second.error,null);
  assert.ok(p.result.second.cliCapabilities>0,'the next learn found the sandbox and investigated the program');
  assert.ok(spawns(p.events).slice(0,lost+1).every((e:any)=>e.probe),'only probes ran until one passed');
  assert.ok(spawns(p.events).length>lost+1,'the investigation ran confined after the probe passed');
});

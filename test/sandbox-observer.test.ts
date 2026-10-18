import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { hostSandbox } from '../src/core/sandbox.ts';
const skip=(await hostSandbox())?false:'host sandbox unavailable';

function probe(mode:string,quick=false) {
  const dir=mkdtempSync(join(tmpdir(),'rcx-observer-')),file=join(dir,'result.json'),trace=join(dir,'trace');
  try {
    execFileSync(process.execPath,['--import',resolve('experiments/sandbox/trace-resources.mjs'),resolve('experiments/sandbox/probe-observer-failure.ts'),file,...quick?['quick']:[]],{
      timeout:10000,env:{...process.env,RCX_RESOURCE_TRACE:trace,RCX_RESOURCE_FAULT:mode},stdio:'pipe',
    });
    return {result:JSON.parse(readFileSync(file,'utf8')),events:readdirSync(trace).flatMap(f=>JSON.parse(readFileSync(join(trace,f),'utf8')).events)};
  } finally {rmSync(dir,{recursive:true,force:true})}
}

test('sandbox refuses availability when the resource observer fails', {skip},()=>{
  const p=probe('ps-error');
  assert.equal(p.result.sandbox,null);
  assert.equal(p.events.filter((e:any)=>e.kind==='spawn').length,1,'only the bounded availability probe was dispatched');
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

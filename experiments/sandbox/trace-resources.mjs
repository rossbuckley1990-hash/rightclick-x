// Diagnostic preload: observes the existing child_process APIs without changing
// source or scheduling policy. Optional failure injection affects only the exact
// memory/process-count ps call. No unrelated command lines or ps rows are saved.
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const out=process.env.RCX_RESOURCE_TRACE;
if (!out) throw new Error('RCX_RESOURCE_TRACE directory required');
mkdirSync(out,{recursive:true});
const cp=createRequire(import.meta.url)('node:child_process');
const originalSpawn=cp.spawn, originalExecFile=cp.execFile;
const groups=new Map(),events=[];
let polls=0;
const record=e=>{if(events.length<20000)events.push({at:Date.now(),...e})};
cp.spawn=function(command,args,options){
 const child=originalSpawn.apply(this,arguments);
 if(command==='/usr/bin/sandbox-exec'||command==='/usr/bin/bwrap'||command==='/bin/bwrap'){
   if(child.pid)groups.set(child.pid,Date.now());
   record({kind:'spawn',pgid:child.pid});
   child.once('close',(code,signal)=>{record({kind:'close',pgid:child.pid,code,signal});groups.delete(child.pid)});
 }
 return child;
};
cp.execFile=function(command,args,options,callback){
 if(command!=='/bin/ps'||JSON.stringify(args)!==JSON.stringify(['-A','-o','pgid=,rss=']))return originalExecFile.apply(this,arguments);
 const start=Date.now();record({kind:'poll-start',groups:[...groups.keys()]});
 polls++;
 const finish=(error,stdout,stderr)=>{
   const measurements=[...groups.keys()].map(pgid=>({pgid,rss:0,procs:0}));
   if(!error)for(const line of String(stdout).split('\n')){const [pgid,rss]=line.trim().split(/\s+/).map(Number);const target=measurements.find(m=>m.pgid===pgid);if(target){target.rss+=(rss||0)*1024;target.procs++}}
   record({kind:'poll-end',ms:Date.now()-start,error:error?{code:error.code,killed:error.killed,signal:error.signal}:null,measurements});
   callback(error,stdout,stderr);
 };
 const mode=process.env.RCX_RESOURCE_FAULT;
 if(mode==='ps-error'||(polls>1&&['after-probe-error','late-error'].includes(mode))){setTimeout(()=>finish(Object.assign(new Error('injected resource observer error'),{code:'EIO'}),'',''),mode==='late-error'?150:0);return;}
 if(mode==='malformed'){queueMicrotask(()=>finish(null,'not a numeric process snapshot\n',''));return;}
 if(mode==='slow')return originalExecFile.call(this,command,args,options,(...values)=>setTimeout(()=>finish(...values),150));
 return originalExecFile.call(this,command,args,options,finish);
};
syncBuiltinESMExports();
process.on('exit',()=>writeFileSync(join(out,`${process.pid}.json`),JSON.stringify({pid:process.pid,mode:process.env.RCX_RESOURCE_FAULT||'observe',node:process.version,events},null,2)+'\n'));

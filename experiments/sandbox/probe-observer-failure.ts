// Preload trace-resources.mjs with RCX_RESOURCE_FAULT=ps-error. The workload
// itself is harmless; this asks whether observer loss stops a running command.
import { hostSandbox } from '../../src/core/sandbox.ts';
import { writeFileSync } from 'node:fs';
const sb=await hostSandbox();if(!sb){writeFileSync(process.argv[2],JSON.stringify({sandbox:null,refused:'unavailable'})+'\n');process.exit(0)}
const r=process.argv[3]==='quick' ? await sb.run('/bin/echo',['candidate-output']) : await sb.run('/bin/sleep',['0.5']);
writeFileSync(process.argv[2],JSON.stringify({sandbox:sb.kind,result:r},null,2)+'\n');

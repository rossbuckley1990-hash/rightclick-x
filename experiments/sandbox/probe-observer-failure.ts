// Preload trace-resources.mjs with RCX_RESOURCE_FAULT=ps-error. The workload
// itself is harmless; this asks whether observer loss stops a running command.
import { hostSandbox } from '../../src/core/sandbox.ts';
import { writeFileSync } from 'node:fs';
const sb=await hostSandbox();if(!sb)throw new Error('sandbox unavailable');
const r=await sb.run('/bin/sleep',['0.5']);
writeFileSync(process.argv[2],JSON.stringify({sandbox:sb.kind,result:r},null,2)+'\n');

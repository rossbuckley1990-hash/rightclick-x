// Exposed resource-control diagnostic. Never runs more than one bounded probe.
import { hostSandbox } from '../../src/core/sandbox.ts';
import { writeFileSync } from 'node:fs';
const [bin, output] = process.argv.slice(2);
if (!bin || !output) throw new Error('usage: probe-memory.ts COMPILED_PROBE NEW_OUTPUT');
const sandbox = await hostSandbox();
if (!sandbox) throw new Error('sandbox unavailable');
const rows=[];
for (const [mib,holdMs,budgetMiB] of [[16,0,64],[128,0,64],[128,3000,64],[900,3000,512]]) {
  const result=await sandbox.run(bin,[String(mib),String(holdMs)],{limits:{timeoutMs:15000,maxMemoryBytes:budgetMiB*1024*1024}});
  let measured;try{measured=JSON.parse(result.stdout)}catch{}
  rows.push({mib,holdMs,budgetMiB,result,measured,exceededAndCompleted:!!measured?.done&&measured.peakRSS>budgetMiB*1024*1024});
  writeFileSync(output,JSON.stringify({scope:'bounded native resource diagnostic, not a new holdout',node:process.version,sandbox:sandbox.kind,rows},null,2)+'\n');
}

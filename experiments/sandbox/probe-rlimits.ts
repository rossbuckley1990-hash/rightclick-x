// Standard-kernel-limit feasibility probe; no product change and no claim that
// a per-process limit supplies aggregate process-group containment.
import { hostSandbox } from '../../src/core/sandbox.ts';
import { writeFileSync } from 'node:fs';
const [bin,out]=process.argv.slice(2), sb=await hostSandbox();
if(!sb)throw new Error('sandbox unavailable');
const rows=[];
for(const flag of ['d','v']) for(const mib of [16,128]) {
  const script=`ulimit -H -${flag} 65536 || exit 77; ulimit -S -${flag} 65536 || exit 78; exec "$0" "$@"`;
  const result=await sb.run('/bin/sh',['-c',script,bin,String(mib),'0']);
  rows.push({flag,mib,limitKiB:65536,result});
  writeFileSync(out,JSON.stringify({scope:'per-process data/address-space feasibility only',rows},null,2)+'\n');
}

// Fresh-process read of the disposable browser fixture's retained state.
import { readFileSync, writeFileSync } from 'node:fs';
import { RightClick } from '../../src/runtime.ts';
import { capabilityState } from '../../src/interface/dashboard-state.ts';
const state=JSON.parse(readFileSync(process.argv[2],'utf8'));
const rc=await RightClick.create({directories:[],authority:{execution:{allowedRisks:[]}},fetch:async()=>{throw new Error('reload inspection must not dispatch')},store:{load:async()=>state,save:async()=>{}}});
const capability=capabilityState(rc,'goal:observed-weather');
if(capability.states.validity.state!=='dependencies-changed'||capability.states.authority.state!=='unknown'||rc.runs.size)throw new Error('fresh process state mismatch');
writeFileSync(process.argv[3],JSON.stringify({capability,activity:rc.activity.snapshot(),runs:rc.runs.size},null,2)+'\n');
await rc.flush();

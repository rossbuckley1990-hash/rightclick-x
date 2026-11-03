import {RecoveringWorkflow} from '../rightclick-x/src/recovery.ts';
const execute=RecoveringWorkflow.prototype.execute;
RecoveringWorkflow.prototype.execute=async function(inputs){const r=await execute.call(this,inputs);if(r.status!=='verified') console.log('RECOVERY_DIAGNOSTIC '+JSON.stringify(r));return r;};

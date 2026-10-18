// Deterministic synthetic topology benchmark. Measures API construction only;
// not real provider usefulness, browser rendering, model economics or a holdout.
import { RightClick } from '../../src/runtime.ts';
import { createHandler } from '../../src/interface/http.ts';
import { writeFileSync } from 'node:fs';
import { cpus, platform, release } from 'node:os';
const rows=[];
for (const size of [100, 1000, 10000]) {
  const rc=await RightClick.create({directories:[],authority:{execution:{allowedRisks:[]}}});
  rc.graph.measuring=false;
  const template=rc.graph.get('builtin:html.text')!;
  const t0=performance.now();
  for(let start=0;start<size;start+=20){const provider=`benchmark:${start/20}`;
    const capabilities=Array.from({length:Math.min(20,size-start)},(_,offset)=>{const i=start+offset;return {...structuredClone(template),id:`benchmark:operation-${i}`,provider,title:`Synthetic operation ${i}`,inputs:[{name:'input',type:`benchmark.type-${i%100}`,required:true}],outputs:[{name:'',type:`benchmark.type-${(i+1)%100}`}]} });
    rc.graph.add({provider:{id:provider,title:`Synthetic provider ${start/20}`,source:'builtin',origin:'benchmark',learnedAt:new Date().toISOString(),capabilityIds:capabilities.map(c=>c.id)},capabilities});
  }
  const buildMs=performance.now()-t0, handler=createHandler(rc,{open:true});
  const measurements=[];
  for(const path of ['/api/overview','/api/overview','/api/capabilities?limit=50','/api/capabilities?limit=50&offset=50','/api/capabilities?search=operation-9999','/api/activity?limit=100']){
    const start=performance.now(), response=await handler(new Request('https://runtime.test'+path)), body=await response.text();
    const parsed=JSON.parse(body);
    measurements.push({path,ms:performance.now()-start,bytes:Buffer.byteLength(body),items:parsed.items?.length??parsed.entries?.length??parsed.providers?.length});
    if(parsed.items?.length>50||parsed.entries?.length>100||parsed.providers?.length>200)throw new Error('response bound failed');
  }
  if(rc.runs.size)throw new Error('a dashboard read executed software');
  rows.push({syntheticDescriptors:size,totalDescriptors:rc.graph.capabilities.size,buildMs,measurements,rss:process.memoryUsage().rss});
}
const result={scope:'Synthetic API-construction benchmark, no browser/model/provider execution',node:process.version,platform:platform(),release:release(),cpu:cpus()[0]?.model,rows};
writeFileSync(process.argv[2],JSON.stringify(result,null,2)+'\n');

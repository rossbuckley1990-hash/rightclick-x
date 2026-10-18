// Generic public-contract development driver. Configuration supplies sources and
// goals, never reflection objects, provider adapters, output values or mappings.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { RightClick } from '../../src/runtime.ts';
const [configPath, destination] = process.argv.slice(2);
if (!configPath || !destination) throw new Error('usage: public-discovery.ts CONFIG NEW_OUTPUT_DIRECTORY');
const config=JSON.parse(readFileSync(configPath,'utf8')),out=resolve(destination);
mkdirSync(out,{recursive:false});
const save=(name:string,value:unknown)=>writeFileSync(join(out,name+'.json'),JSON.stringify(value,null,2)+'\n');
const sources=config.sources as {url:string;kind:'openapi'|'graphql'}[];
const origins=[...new Set(sources.map(s=>new URL(s.url).origin))];
const history:any[]=[];let sequence=0,bytes=0;let state:any=null;
const queues=new Map<string,Promise<void>>(),next=new Map<string,number>();
const net:typeof fetch=async(input,init)=>{
 const req=new Request(input,init),url=new URL(req.url),id=++sequence;
 if(id>24||bytes>32*1024*1024)throw new Error('development request/body budget reached');
 if(!origins.includes(url.origin))throw new Error('development egress refused');
 const body=req.method==='POST'?await req.clone().text():undefined;
 if(!['GET','HEAD'].includes(req.method)){
  if(req.method!=='POST'||!sources.some(s=>s.kind==='graphql'&&s.url===req.url)||!body)throw new Error('only public reads and declared GraphQL queries allowed');
  const query=JSON.parse(body).query;
  if(typeof query!=='string'||!/^\s*(query\b|\{)/.test(query)||/\bmutation\b/.test(query))throw new Error('non-query GraphQL request refused');
 }
 const previous=queues.get(url.origin)??Promise.resolve();let release!:()=>void;
 queues.set(url.origin,new Promise<void>(r=>{release=r}));await previous;
 await new Promise(r=>setTimeout(r,Math.max(0,(next.get(url.origin)??0)-Date.now())));
 next.set(url.origin,Date.now()+1100);
 const entry:any={id,at:new Date().toISOString(),url:req.url,method:req.method,body};history.push(entry);
 try{
  const headers=new Headers(req.headers);headers.set('user-agent','RightClick-X-development-readonly/0.1');
  const response=await fetch(new Request(req,{headers}));
  const text=await response.clone().text();bytes+=Buffer.byteLength(text);
  entry.status=response.status;entry.responseBytes=Buffer.byteLength(text);entry.sha256=createHash('sha256').update(text).digest('hex');
  writeFileSync(join(out,`response-${id}.txt`),text);return response;
 }catch(error){entry.error=String(error);throw error}
 finally{save('network',history);release()}
};
save('provenance',{revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),node:process.version,config,scope:'exposed public-provider development experiment; not final holdout, independent author evaluation or commercial proof'});
const rc=await RightClick.create({name:'Public capability development',fetch:net,sandbox:null,network:{blockPrivate:true,origins},authority:{investigate:[],execute:[],execution:{allowedRisks:['read'],allowedOrigins:origins},publish:'checked'},store:{load:async()=>null,save:async s=>{state=s;save('state',s)}}});
save('baseline',{providers:[...rc.graph.providers.values()],capabilities:rc.graph.list()});
try{
 save('learn',await rc.learn({sources:sources.map(s=>s.url),kinds:Object.fromEntries(sources.map(s=>[s.url,s.kind]))}));
 save('discovered',{providers:[...rc.graph.providers.values()],capabilities:rc.graph.list()});
 for(let index=0;index<(config.goals??[]).length;index++)save(`goal-${index}`,await rc.compose(config.goals[index]));
}catch(error){save('error',{error:String(error)});process.exitCode=1}
finally{await rc.flush();save('activity',rc.activity.snapshot());save('final',{providers:rc.graph.providers.size,operations:rc.graph.capabilities.size,published:state?.published??[],networkRequests:history.length,responseBytes:bytes})}

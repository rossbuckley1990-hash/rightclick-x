import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RightClick } from '../src/runtime.ts';
import { inferType } from '../src/core/semantics.ts';
import { reflectGraphQL } from '../src/reflectors/graphql.ts';
const json=(value:unknown)=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
const scalar={kind:'SCALAR',name:'String',ofType:null};
const object=(name:string)=>({kind:'OBJECT',name,ofType:null});
const field=(name:string,type:unknown=scalar,args:unknown[]=[])=>({name,description:'',type,args});
function fixture(list=false,needsArgument=false,early=false){
 const calls:string[]=[];
 let omitPublisher=false;
 const intro={data:{__schema:{queryType:{name:'Query'},mutationType:null,types:[
  {kind:'OBJECT',name:'Query',fields:[field('record',object('Record'),[{name:'record_id',description:'Record identifier',type:{kind:'NON_NULL',name:null,ofType:scalar},defaultValue:null}])]},
  {kind:'OBJECT',name:'Record',fields:[...Array.from({length:early?0:27},(_,i)=>field(`f${i}`)),field('references',list?{kind:'LIST',name:null,ofType:object('Reference')}:object('Reference'))]},
  {kind:'OBJECT',name:'Reference',fields:[field('reference_id',scalar,needsArgument?[{name:'secret',type:{kind:'NON_NULL',name:null,ofType:scalar},defaultValue:null}]:[])]},
  {kind:'SCALAR',name:'String'}
 ]}}};
 const spec={
  openapi:'3.0.0',info:{title:'Publication facts'},servers:[{url:'https://facts.test'}],
  paths:{'/facts/{reference_id}':{get:{
   operationId:'lookup',parameters:[{name:'reference_id',in:'path',required:true,schema:{type:'string'}}],
   responses:{'200':{description:'ok',content:{'application/json':{schema:{type:'object',properties:{publisher:{type:'string'},reference_id:{type:'string'}}}}}}}
  }}}
 };
 const fetcher=(async(input:any,init?:RequestInit)=>{
  const u=new URL(typeof input==='string'?input:input.url);
  if(u.host==='records.test'){
   const query=JSON.parse(String(init?.body)).query;
   if(query.includes('__schema'))return json(intro);
   calls.push(query);
   const refs=['R100','R200'].map(reference_id=>({reference_id}));
   return json({data:{record:{f0:'metadata',...(/\breference_id\b/.test(query)?{references:list?refs:refs[0]}:{})}}});
  }
  if(u.pathname==='/openapi.json')return json(spec);
  calls.push(u.href);return json({...(omitPublisher?{}:{publisher:'Fixture publisher'}),reference_id:decodeURIComponent(u.pathname.split('/').at(-1)!)});
 }) as typeof fetch;
 return {fetcher,calls,omit:()=>{omitPublisher=true}};
}
for(const list of [false,true])test(`unselected GraphQL identifier joins a second provider (${list?'list':'scalar'}) and remains reusable`,async()=>{
 const {fetcher,calls}=fixture(list);let state:any=null;
 const options={fetch:fetcher,sandbox:null,authority:{execution:{allowedRisks:['read'] as ['read']},publish:'checked' as const},store:{load:async()=>state,save:async(s:unknown)=>{state=s}}};
 const rc=await RightClick.create(options);
 await rc.learn({sources:['https://records.test/graphql','https://facts.test/openapi.json'],kinds:{'https://records.test/graphql':'graphql','https://facts.test/openapi.json':'openapi'}});
 const cap=rc.graph.list().find(c=>c.invoke.kind==='graphql')!;
 assert.ok(cap.outputs.some(o=>o.name==='references.reference_id'&&o.type===(list?'list:id.reference':'id.reference')),'contract-known identifier outside default selection must be available to planning');
 const r=await rc.compose({have:{record_id:'K100'},want:'json',require:['publisher'],maxSteps:2,run:true,verify:[{op:'contains',value:'Fixture publisher'}],publish:'Lookup publication facts'});
 assert.equal(r.executed?.status,'completed',JSON.stringify(r));
 assert.equal(r.plans[0].providers.length,2);
 assert.ok(calls.some(c=>/references\s*\{\s*reference_id/.test(c)),'the producer must request the bound field');
 assert.ok(r.published);
 await rc.flush();const fresh=await RightClick.create(options);calls.length=0;
 const reused=await fresh.run(r.published!.id,{record_id:'K200'});
 assert.equal(reused.status,'completed',JSON.stringify(reused));
 assert.ok(calls.some(c=>/references\s*\{\s*reference_id/.test(c)));
 assert.ok(!calls.some(c=>c.includes('__schema')),'reuse must not repeat introspection');
});
test('GraphQL fields requiring unsupplied arguments are not projected as join outputs',async()=>{
 const {fetcher}=fixture(false,true);const rc=await RightClick.create({fetch:fetcher,sandbox:null});
 await rc.learn({source:'https://records.test/graphql',kinds:{'https://records.test/graphql':'graphql'}});
 assert.ok(!rc.graph.list().find(c=>c.invoke.kind==='graphql')!.outputs.some(o=>o.name==='references.reference_id'));
});
test('DOI field names identify the same scheme without matching incidental substrings',()=>{
 for(const name of ['doi','publication_doi','pdbx_database_id_DOI'])assert.equal(inferType(name,{type:'string'}),'id.doi');
 assert.equal(inferType('medoid',{type:'string'}),'text');
 assert.equal(inferType('doi',{type:'number'}),'number');
});

test('a late identifier used as the final result is projected without require terms',async()=>{
 const {fetcher}=fixture();const rc=await RightClick.create({fetch:fetcher,sandbox:null});
 await rc.learn({source:'https://records.test/graphql',kinds:{'https://records.test/graphql':'graphql'}});
 const result=await rc.compose({have:{record_id:'K100'},want:'id.reference',maxSteps:1,run:true});
 assert.equal(result.executed?.status,'completed');assert.equal(result.executed?.output,'R100');
});

test('required output information survives both retained forms and prevents publication of missing results',async()=>{
 const {fetcher,omit}=fixture(false,false,true);const rc=await RightClick.create({fetch:fetcher,sandbox:null,authority:{publish:'checked'}});
 await rc.learn({sources:['https://records.test/graphql','https://facts.test/openapi.json'],kinds:{'https://records.test/graphql':'graphql','https://facts.test/openapi.json':'openapi'}});
 const goal={have:{record_id:'K100'},want:'json',require:['publisher'],maxSteps:2,run:true,verify:[{op:'type' as const,value:'object' as const}],publish:'Required facts'};
 const first=await rc.compose(goal);assert.equal(first.executed?.status,'completed');assert.ok(first.crystallized&&first.published);
 omit();
 for(const id of [first.crystallized!.id,first.published!.id]){
  const changed=await rc.run(id,{record_id:'K200'});assert.equal(changed.status,'failed',JSON.stringify(changed));assert.equal(changed.verification.status,'refuted');
 }
 const bad=await rc.compose({...goal,publish:'Must not publish'});
 assert.notEqual(bad.executed?.status,'completed');assert.equal(bad.published,undefined);
});

test('bounded identifier discovery keeps scalar joins ahead of earlier list fanouts',()=>{
 const intro={data:{__schema:{queryType:{name:'Query'},mutationType:null,types:[
  {kind:'OBJECT',name:'Query',fields:[field('record',object('Record'))]},
  {kind:'OBJECT',name:'Record',fields:[...Array.from({length:100},(_,i)=>field(`related${i}`,{kind:'LIST',name:null,ofType:object('Reference')})),field('primary',object('Reference'))]},
  {kind:'OBJECT',name:'Reference',fields:[field('reference_id')]},{kind:'SCALAR',name:'String'}
 ]}}};
 const c=reflectGraphQL(intro,'https://unfamiliar.test/graphql').capabilities[0];
 assert.ok(c.outputs.some(o=>o.name==='primary.reference_id'&&o.type==='id.reference'));
 assert.ok(c.outputs.length<=1+25+64,'additional planning ports remain bounded');
 assert.equal(c.fields?.find(f=>f.path==='primary.reference_id')?.selected,false,'promoting a field must not claim it is already selected');
});

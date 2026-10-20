import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as enums from '@prisma/client';
import {test} from 'node:test';
import {HttpError} from '../src/lib/utils/http';

const now=new Date('2026-10-20T12:00:00Z');
function harness(changeBeforeLock?:(state:any)=>void){
 const state:any={job:{id:'job',organisationId:'org',projectId:'project',type:'BUILDING_WARRANT',status:'CLAIMED',
  claimedByAgentId:'agent',claimedDeviceId:'device',agentRunId:'run',leaseExpiresAt:new Date(now.getTime()-1)}};
 const ownership:any[]=[],revoked:string[]=[],actions:any[]=[];
 const matches=(row:any,where:any):boolean=>Boolean(row)&&Object.entries(where).every(([key,value]:[string,any])=>{
  if(value&&typeof value==='object'&&!(value instanceof Date)){
   if('lte' in value)return row[key]<=value.lte;
   if('in' in value)return value.in.includes(row[key]);
   if('not' in value)return row[key]!==value.not;
  }
  return row[key]===value;
 });
 let changed=false;
 const db:any={
  $executeRaw:async()=>{if(!changed){changed=true;changeBeforeLock?.(state);}},
  automationJob:{
   findMany:async({where}:any)=>matches(state.job,where)?[structuredClone(state.job)]:[],
   findFirst:async({where}:any)=>matches(state.job,where)?structuredClone(state.job):null,
   updateMany:async({where,data}:any)=>{if(!matches(state.job,where))return {count:0};Object.assign(state.job,data);return {count:1};},
  },
  desktopAccessToken:{updateMany:async({where}:any)=>{revoked.push(where.id);return {count:1};}},
  actionItem:{upsert:async(args:any)=>{actions.push(args);return {};}}
 };
 db.$transaction=async(fn:any)=>fn(db);
 const modules:any={
  '@prisma/client':enums,'@/lib/db/prisma':{prisma:db},
  '@/server/services/desktop-execution.service':{lockOrganisationExecution:async(tx:any)=>tx.$executeRaw(),releaseAgentExecution:async()=>{throw new Error('No review release expected');}},
  '@/server/services/automation-state-model.service':{recordAutomationOwnership:async(_tx:any,_scope:any,input:any)=>{
   if(!state.job)throw new HttpError(404,'Automation job not found.');
   ownership.push({run:state.job.agentRunId,...input});
  }},
  '@/lib/validation/desktop-handoff':{DESKTOP_CALLBACK_CONTRACT_VERSION:1},
  '@/lib/validation/desktop-agent':{DESKTOP_PROGRESS_CONTRACT_VERSION:1},
 };
 const compiled=ts.transpileModule(readFileSync('src/server/services/desktop-agent.service.ts','utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const api:any={};vm.runInNewContext(compiled,{exports:api,require:(name:string)=>{assert.ok(name in modules,name);return modules[name];},Date});
 return {state,ownership,revoked,actions,run:()=>api.reconcileStaleAgentJobs({organisationId:'org',now,database:db})};
}

for(const [label,change] of [
 ['renewed heartbeat',(state:any)=>{state.job.leaseExpiresAt=new Date(now.getTime()+120000);}],
 ['automation started',(state:any)=>{state.job.status='IN_PROGRESS';}],
 ['new claim',(state:any)=>{state.job.agentRunId='successor-run';state.job.claimedDeviceId='successor-device';}],
 ['cancelled attempt',(state:any)=>{state.job.status='CANCELLED';}],
] as const){
 test(`stale claim scan does not record an interruption after ${label}`,async()=>{
  const h=harness(change);const result=await h.run();
  assert.equal(result.returnedReady,0);assert.deepEqual(h.ownership,[]);assert.deepEqual(h.revoked,[]);assert.deepEqual(h.actions,[]);
 });
}
test('a project deleted while the cleanup waits does not abort reconciliation',async()=>{
 const h=harness(state=>{state.job=null;});
 const result=await h.run();assert.equal(result.returnedReady,0);assert.deepEqual(h.ownership,[]);
});
test('a genuinely expired claim records its old identity and becomes ready exactly once',async()=>{
 const h=harness();const result=await h.run();
 assert.equal(result.returnedReady,1);assert.equal(h.state.job.status,'READY');assert.equal(h.state.job.agentRunId,null);
 assert.deepEqual(h.ownership,[{run:'run',reason:'claim_expired',state:'INTERRUPTED'}]);assert.deepEqual(h.revoked,['device']);assert.equal(h.actions.length,1);
 assert.equal((await h.run()).returnedReady,0);assert.equal(h.ownership.length,1);
});

test('a genuinely expired running attempt keeps its identity and requires review',async()=>{
 const h=harness();h.state.job.status='IN_PROGRESS';
 const result=await h.run();assert.equal(result.needsReview,1);assert.equal(h.state.job.status,'NEEDS_REVIEW');
 assert.equal(h.state.job.agentRunId,'run');assert.deepEqual(h.revoked,[]);assert.equal(h.ownership.length,1);
});
test('a running attempt renewed before the cleanup lock is left running',async()=>{
 const h=harness(state=>{state.job.leaseExpiresAt=new Date(now.getTime()+120000);});h.state.job.status='IN_PROGRESS';
 const result=await h.run();assert.equal(result.needsReview,0);assert.equal(h.state.job.status,'IN_PROGRESS');assert.deepEqual(h.ownership,[]);
});

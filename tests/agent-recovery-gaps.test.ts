import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as prismaTypes from '@prisma/client';
import { releaseAgentExecution, lockOrganisationExecution, assertRegisteredAgentActive } from '../src/server/services/desktop-execution.service';
import { agentHeartbeatSchema } from '../src/lib/validation/desktop-agent';
import { HttpError, jsonResponse } from '../src/lib/utils/http';
import { withErrorHandling, parseBody } from '../src/lib/utils/handlers';

const runId='11111111-1111-4111-8111-111111111111';
function harness(job: any = null) {
 let writes=0;
 const tx: any={
  $executeRaw: async()=>{},
  automationJob:{
   findFirst:async({where}: any)=>{
    if(!job) return null;
    return Object.entries(where).every(([key,value]: [string,any])=>{
     if(key==='OR') return value.some((part:any)=>Object.entries(part).every(([k,v])=>job[k]===v));
     if(value && typeof value==='object' && !(value instanceof Date)) {
      if('not' in value) return job[key]!==value.not;
      return false;
     }
     return job[key]===value;
    }) ? job : null;
   },
   updateMany:async()=>{writes++;return {count:0};},
  },
  agentRegistration:{
   findFirst:async()=>({id:'agent-a',organisationId:'org-a',enabled:true,revokedAt:null}),
   updateMany:async()=>({count:1}),
  },
  automationJobEvent:{upsert:async()=>{writes++;}},
 };
 tx.$transaction=async(fn:any)=>fn(tx);
 const modules:any={
  '@prisma/client':prismaTypes,
  '@/lib/db/prisma':{prisma:tx},
  '@/lib/server/rate-limit':{assertRateLimit:()=>{},rateLimitPolicies:{desktop:{}}},
  '@/lib/validation/desktop-agent':{agentHeartbeatSchema},
  '@/lib/utils/handlers':{withErrorHandling,parseBody},
  '@/lib/utils/http':{HttpError,jsonResponse},
  '@/server/auth/agent-credential':{requireAgentAuth:async()=>({id:'agent-a',organisationId:'org-a',credentialHash:'test-only'})},
  '@/server/services/desktop-agent.service':{agentLeaseExpiry:(date:Date)=>new Date(date.getTime()+120000),reconcileStaleAgentJobs:async()=>{}},
  '@/server/services/desktop-execution.service':{releaseAgentExecution,lockOrganisationExecution,assertRegisteredAgentActive},
 };
 const compiled=ts.transpileModule(fs.readFileSync('src/pages/api/desktop/heartbeat.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
 const exports:any={};
 vm.runInNewContext(compiled,{exports,require:(name:string)=>{assert.ok(name in modules,name);return modules[name];},Date,console});
 const heartbeat=async(state:string,currentJobId:string|null='deleted-job',agentRunId:string|null=runId)=>{
  const body={version:1,agentVersion:'4.2.6',capabilities:{workflows:['BUILDING_WARRANT'],snapshotVersions:[2],callbackContractVersions:[1],progressContractVersions:[1]},state,currentJobId,agentRunId};
  const response=await exports.POST({request:new Request('https://example.test/api/desktop/heartbeat',{method:'POST',body:JSON.stringify(body)})});
  assert.equal(response.status,200);
  return response.json();
 };
 return {tx,heartbeat,writes:()=>writes};
}

const deleted=harness();
assert.equal((await deleted.heartbeat('READY')).releaseAcknowledged,true,'deleting the old project must not strand the Agent waiting for release');
assert.equal(deleted.writes(),0,'a missing job cannot create an orphan release event');
assert.deepEqual((await deleted.heartbeat('RUNNING')).commands,[{type:'CANCEL_JOB',jobId:'deleted-job',agentRunId:runId}],'a deleted job stops its old local worker at a safe boundary');

const newer={id:'deleted-job',organisationId:'org-a',claimedByAgentId:'agent-b',agentRunId:'22222222-2222-4222-8222-222222222222',status:'IN_PROGRESS'};
const reassigned=harness(newer);
assert.equal((await reassigned.heartbeat('READY')).releaseAcknowledged,true,'the old claim is gone even when the same job has a newer owner');
assert.deepEqual((await reassigned.heartbeat('RUNNING')).commands,[{type:'CANCEL_JOB',jobId:'deleted-job',agentRunId:runId}]);
assert.equal(reassigned.writes(),0,'stale release and stop commands never change the newer owner');

for(const status of ['CLAIMED','IN_PROGRESS','AWAITING_PORTAL_REVIEW']) {
 const owned=harness({...newer,claimedByAgentId:'agent-a',agentRunId:runId,status});
 assert.deepEqual((await owned.heartbeat('RUNNING')).commands,[],`live ${status} worker retains ownership`);
}
console.log('Agent deleted-project and stale-ownership recovery tests passed.');

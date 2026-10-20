import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as enums from '@prisma/client';
import * as schemas from '../src/lib/validation/application-draft';
import {normaliseDraftAddresses} from '../src/lib/addresses/draft-address';
import {normaliseUkAddress} from '../src/lib/addresses/uk-address';
import {BUILDING_WARRANT_CONFIRMATION_DEFAULTS} from '../src/lib/validation/domain';
import {APPLICATION_UPLOAD_LIMITS} from '../src/lib/application-upload-limits';
import {HttpError} from '../src/lib/utils/http';
import {clientReviewFixture} from './fixtures/client-applicant-review';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';

// Deterministic interleavings against real service functions. These do not replace a PostgreSQL integration test.
function harness(commit=false){
 const review=schemas.applicationDraftReviewSchema.parse(clientReviewFixture().review);
 const state:any={id:'draft',organisationId:'org',status:'NEEDS_REVIEW',expiresAt:new Date('2099-01-01'),updatedAt:new Date(),resultingProjectId:null,confirmedData:review,
  documents:[{id:'location-plan',uploadStatus:'READY',documentType:'LOCATION_PLAN',originalFilename:'Location plan.pdf',analysisStatus:'SUCCESS',confidence:0.95,
   revision:null,drawingNumber:null,drawingTitle:null}]};
 let beforeWrite:(()=>void)|undefined;let childWrites=0;let permanentQueries=0;
 const matches=(where:any)=>Object.entries(where).every(([key,value]:[string,any])=>{
  if(value&&typeof value==='object'&&!(value instanceof Date)){
   if('in' in value)return value.in.includes(state[key]);
   if('gt' in value)return state[key]>value.gt;
  }
  return value instanceof Date?value.getTime()===state[key]?.getTime():state[key]===value;
 });
 const unexpected=async()=>{permanentQueries++;throw new Error('Permanent records must not be written');};
 const db:any={
  applicationDraft:{findFirst:async()=>structuredClone(state),updateMany:async({where,data}:any)=>{
   beforeWrite?.();beforeWrite=undefined;if(!matches(where))return {count:0};Object.assign(state,data);return {count:1};
  },update:async({data}:any)=>{Object.assign(state,data);return state;}},
  applicationDraftDocument:{updateMany:async()=>{childWrites++;return {count:1};}},
  organisationDefaults:{findUnique:async()=>null},
  client:{create:unexpected,findFirst:unexpected},project:{create:unexpected,findFirst:unexpected},
  $transaction:async(fn:any)=>fn(db),
 };
 const modules:any={
  'node:crypto':{randomUUID},'@prisma/client':enums,'@/lib/db/prisma':{prisma:db},
  '@/lib/utils/http':{HttpError},'@/lib/application-upload-limits':{APPLICATION_UPLOAD_LIMITS},
  '@/lib/validation/application-draft':schemas,
  '@/lib/validation/domain':{BUILDING_WARRANT_CONFIRMATION_DEFAULTS},
  '@/lib/addresses/draft-address':{normaliseDraftAddresses},'@/lib/addresses/uk-address':{normaliseUkAddress},
  '@/server/services/application-draft.service':{evaluateApplicationDraftReadiness:()=>[],getApplicationDraftForOrganisation:async()=>structuredClone(state)},
  '@/server/services/pdf-classification.service':{configuredDocumentAnalysisIdentity:()=>({provider:'test',model:'test'}),classificationDetailsFromAudit:()=>({manualReviewRequired:false})},
  '@/server/services/site-address-lookup.service':{lookupSiteAddress:async()=>({fields:{},sources:{},status:'incomplete'})},
  '@/server/services/application-draft-matching.service':{findApplicationDraftMatches:async()=>({clients:[],sites:[],projects:[],strongClient:null,strongSite:null}),matchValuesFromPreparation:()=>({})},
 };
 const file=`src/server/services/application-draft${commit?'-commit':''}.service.ts`;
 const compiled=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const api:any={};
 vm.runInNewContext(compiled,{exports:api,require:(name:string)=>{
  if(name in modules)return modules[name];
  assert.ok(name.startsWith('@/server/services/')||['@/lib/server/upload-storage','@/lib/validation/document-intelligence'].includes(name),name);
  return {};
 },Date,Buffer,console});
 return {api,state,review,beforeWrite:(fn:()=>void)=>{beforeWrite=fn;},childWrites:()=>childWrites,permanentQueries:()=>permanentQueries};
}

test('a late autosave cannot resurrect a cancelled draft',async()=>{
 const h=harness();h.beforeWrite(()=>{h.state.status='CANCELLED';});
 await assert.rejects(h.api.saveApplicationDraftReview('draft','org',h.review),/changed/);
 assert.equal(h.state.status,'CANCELLED');assert.equal(h.childWrites(),0);
});
test('autosave rechecks the document set while holding the draft lock',async()=>{
 const h=harness();h.beforeWrite(()=>{h.state.documents.push({id:'new-file',uploadStatus:'UPLOADING'});});
 await assert.rejects(h.api.saveApplicationDraftReview('draft','org',h.review),/document list changed/);
 assert.equal(h.childWrites(),0);
});
test('saving details cannot make an unfinished upload ready to create',async()=>{
 const h=harness();h.state.documents[0].uploadStatus='UPLOADING';
 await h.api.saveApplicationDraftReview('draft','org',h.review);
 assert.equal(h.state.status,'UPLOADING');assert.equal(h.state.confirmedData.client.email,h.review.client.email);
});
test('project creation rechecks files after acquiring the draft lock',async()=>{
 const h=harness(true);h.beforeWrite(()=>{h.state.documents.push({id:'new-file',uploadStatus:'READY'});});
 await assert.rejects(h.api.commitApplicationDraft('draft',{id:'org',name:'Test'},{id:'user',name:'Test',email:'test@example.test'},h.review),/document list changed/);
 assert.equal(h.permanentQueries(),0);
});
test('project creation rejects a file that became incomplete after preflight',async()=>{
 const h=harness(true);h.beforeWrite(()=>{h.state.documents[0].uploadStatus='FAILED';});
 await assert.rejects(h.api.commitApplicationDraft('draft',{id:'org',name:'Test'},{id:'user',name:'Test',email:'test@example.test'},h.review),/Finish uploading/);
 assert.equal(h.permanentQueries(),0);
});

test('a duplicate analysis request cannot mark the active analysis as failed',async()=>{
 const h=harness();h.state.status='ANALYSING';
 await assert.rejects(h.api.analyseApplicationDraft('draft','org'),/already being analysed/);
 assert.equal(h.state.status,'ANALYSING');
});

test('saving a client edit before analysing a newly added PDF does not freeze its placeholder category',async()=>{
 const h=harness();
 h.review.client.email='corrected@example.test';
 Object.assign(h.review.documents[0],{documentType:'OTHER',documentStatus:'IN_REVIEW',revision:'C',drawingNumber:'Architect-12'});
 Object.assign(h.state.documents[0],{documentType:'OTHER',analysisStatus:'PENDING'});
 await h.api.saveApplicationDraftReview('draft','org',h.review);
 // The classifier has now recognised the newly added PDF; synthesis must use it.
 Object.assign(h.state.documents[0],{documentType:'LOCATION_PLAN',analysisStatus:'SUCCESS',confidence:0.95,drawingTitle:'Detected location plan'});
 const result=await h.api.prepareApplicationDraft('draft','org');
 assert.equal(result.review.client.email,'corrected@example.test');
 assert.equal(result.review.documents[0].documentType,'LOCATION_PLAN');
 assert.equal(result.review.documents[0].documentStatus,'APPROVED');
 assert.equal(result.review.documents[0].drawingTitle,'Detected location plan');
 assert.equal(result.review.documents[0].revision,'C');
 assert.equal(result.review.documents[0].drawingNumber,'Architect-12');
});

test('reanalysis preserves an explicitly accepted Other category and drawing edits',async()=>{
 const h=harness();Object.assign(h.review.documents[0],{documentType:'OTHER',documentStatus:'APPROVED',drawingTitle:'Architect title',revision:'B'});
 h.state.confirmedData=structuredClone(h.review);
 const result=await h.api.prepareApplicationDraft('draft','org');
 assert.equal(result.review.documents[0].documentType,'OTHER');
 assert.equal(result.review.documents[0].drawingTitle,'Architect title');
 assert.equal(result.review.documents[0].revision,'B');
});

test('placeholder recovery does not replace an existing non-Other review category',async()=>{
 const h=harness();h.review.documents[0].documentStatus='IN_REVIEW';
 h.state.confirmedData=structuredClone(h.review);
 h.state.documents[0].documentType='OTHER';
 const result=await h.api.prepareApplicationDraft('draft','org');
 assert.equal(result.review.documents[0].documentType,'LOCATION_PLAN');
 assert.equal(result.review.documents[0].documentStatus,'IN_REVIEW');
});

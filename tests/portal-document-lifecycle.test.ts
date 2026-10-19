import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as enums from '@prisma/client';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {test} from 'node:test';
import {APPLICATION_UPLOAD_LIMITS} from '../src/lib/application-upload-limits';
import {HttpError} from '../src/lib/utils/http';
import {clientReviewFixture} from './fixtures/client-applicant-review';

function harness() {
 const review=clientReviewFixture().review!;
 const state:any={id:'draft-test',organisationId:'org-test',status:'NEEDS_REVIEW',expiresAt:new Date('2099-01-01'),confirmedData:structuredClone(review),resultingProjectId:null,
  documents:[{id:'location-plan',draftId:'draft-test',storageKey:'old.pdf',originalFilename:'old.pdf',sizeBytes:8,uploadStatus:'READY',committedDocumentId:null,updatedAt:new Date(0)}]};
 const deleted:string[]=[];
 let metadata:any={sizeBytes:8};
 let beforeWrite:(()=>void)|undefined;
 const matches=(row:any,where:any):boolean=>Object.entries(where).every(([key,value]:[string,any])=>{
  if(key==='draft') return matches(state,value);
  if(value && typeof value==='object' && !(value instanceof Date)) {
   if('notIn' in value) return !value.notIn.includes(row[key]);
   if('in' in value) return value.in.includes(row[key]);
   if('lte' in value) return row[key]<=value.lte;
   if('gt' in value) return row[key]>value.gt;
  }
  return row[key]===value;
 });
 const db:any={
  applicationDraft:{
   findFirst:async({where}:any)=>matches(state,where)?state:null,
   findMany:async()=>[],
   update:async({data}:any)=>{Object.assign(state,data);return state;},
   updateMany:async({where,data}:any)=>{beforeWrite?.();beforeWrite=undefined;if(!matches(state,where))return {count:0};Object.assign(state,data);return {count:1};},
  },
  applicationDraftDocument:{
   findFirst:async({where}:any)=>state.documents.find((doc:any)=>matches(doc,where))??null,
   update:async({where,data}:any)=>{const doc=state.documents.find((doc:any)=>matches(doc,where));Object.assign(doc,data);return doc;},
   count:async({where}:any)=>state.documents.filter((doc:any)=>matches(doc,where)).length,
   create:async({data}:any)=>{const doc={...data,committedDocumentId:null,updatedAt:new Date()};state.documents.push(doc);return doc;},
   findMany:async({where}:any={})=>state.documents.filter((doc:any)=>!where||matches(doc,where)),
   deleteMany:async({where}:any)=>{const found=state.documents.filter((doc:any)=>matches(doc,where));state.documents=state.documents.filter((doc:any)=>!matches(doc,where));return {count:found.length};},
  },
  projectDocument:{aggregate:async()=>({_sum:{sizeBytes:0}})},
  $transaction:async(fn:any)=>typeof fn==='function'?fn(db):Promise.all(fn),
 };
 const modules:any={
  'node:crypto':{createHash,randomUUID},'node:path':path,'@prisma/client':enums,
  '@/lib/application-upload-limits':{APPLICATION_UPLOAD_LIMITS},'@/lib/db/prisma':{prisma:db},'@/lib/utils/http':{HttpError},
  '@/lib/server/upload-storage':{getStoredDocumentMetadata:async()=>metadata,createSignedDirectUpload:async()=>({uploadUrl:'https://storage.test/signed',token:'test-only'}),deleteStoredDocument:async(key:string)=>{deleted.push(key);}},
  '@/server/services/application-draft.service':{getApplicationDraftForOrganisation:async()=>structuredClone(state)},
 };
 const compiled=ts.transpileModule(readFileSync('src/server/services/application-draft-files.service.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 const exports:any={};
 vm.runInNewContext(compiled,{exports,require:(name:string)=>{assert.ok(name in modules,name);return modules[name];},Date,Buffer,console});
 return {state,deleted,api:exports,beforeWrite:(fn:()=>void)=>{beforeWrite=fn;},review,metadata:(value:any)=>{metadata=value;}};
}

test('adding a PDF preserves saved client and application review details',async()=>{
 const h=harness();
 await h.api.createApplicationDraftUploadIntent('draft-test','org-test',{filename:'extra.pdf',mimeType:'application/pdf',size:8,clientSha256:'a'.repeat(64)});
 assert.deepEqual(h.state.confirmedData,h.review);
});
test('removing a PDF preserves the saved review',async()=>{
 const h=harness();await h.api.removeApplicationDraftDocument('draft-test','location-plan','org-test');
 assert.deepEqual(h.state.confirmedData,h.review);
});
test('cancellation cannot delete storage after a concurrent project commit wins',async()=>{
 const h=harness();
 h.beforeWrite(()=>{h.state.status='COMMITTED';h.state.resultingProjectId='created-project';h.state.documents[0].committedDocumentId='permanent-doc';});
 await assert.rejects(h.api.cancelApplicationDraft('draft-test','org-test'),/created|changed|cancel/i);
 assert.equal(h.state.status,'COMMITTED');assert.deepEqual(h.deleted,[]);
});
test('same name and size are distinct when PDF hashes differ; a retry keeps its identity',async()=>{
 const h=harness();
 const input={filename:'same.pdf',mimeType:'application/pdf',size:8};
 const first=await h.api.createApplicationDraftUploadIntent('draft-test','org-test',{...input,clientSha256:'a'.repeat(64)});
 const other=await h.api.createApplicationDraftUploadIntent('draft-test','org-test',{...input,clientSha256:'b'.repeat(64)});
 const retry=await h.api.createApplicationDraftUploadIntent('draft-test','org-test',{...input,clientSha256:'a'.repeat(64)});
 assert.notEqual(first.document.id,other.document.id);assert.equal(retry.document.id,first.document.id);
});

test('removal never deletes bytes if project creation wins the draft lock',async()=>{
 const h=harness();
 h.beforeWrite(()=>{h.state.status='COMMITTING';h.state.resultingProjectId='created-project';h.state.documents[0].committedDocumentId='permanent-doc';});
 await assert.rejects(h.api.removeApplicationDraftDocument('draft-test','location-plan','org-test'),/cannot be changed/i);
 assert.deepEqual(h.deleted,[]);assert.equal(h.state.documents.length,1);
});

test('long filenames retain their PDF extension',async()=>{
 const h=harness();const input={filename:`${'drawing'.repeat(40)}.pdf`,mimeType:'application/pdf',size:8};
 const result=await h.api.createApplicationDraftUploadIntent('draft-test','org-test',input);
 assert.equal(result.document.originalFilename.length,180);assert.ok(result.document.originalFilename.endsWith('.pdf'));
});

test('finalisation never deletes a document if project creation wins',async()=>{
 const h=harness();h.state.documents[0].uploadStatus='UPLOADING';h.metadata(null);
 h.beforeWrite(()=>{h.state.status='COMMITTED';h.state.resultingProjectId='project';h.state.documents[0].committedDocumentId='permanent-doc';});
 await assert.rejects(h.api.finaliseApplicationDraftDocument('draft-test','location-plan','org-test'),/cannot be changed/);
 assert.deepEqual(h.deleted,[]);
});

test('a stale incomplete-upload response cannot remove a concurrently finalised PDF',async()=>{
 const h=harness();h.state.documents[0].uploadStatus='UPLOADING';h.metadata(null);
 h.beforeWrite(()=>{h.state.documents[0].uploadStatus='READY';});
 const result=await h.api.finaliseApplicationDraftDocument('draft-test','location-plan','org-test');
 assert.equal(result.uploadStatus,'READY');assert.deepEqual(h.deleted,[]);
});


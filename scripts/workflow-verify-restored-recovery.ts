import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {Prisma} from '@prisma/client';
import {chromium,expect} from '@playwright/test';
import {prisma} from '../src/lib/db/prisma';
assert.equal(new URL(process.env.DATABASE_URL!).searchParams.get('schema'),'workflow_overhaul_preview_20261009');
assert.equal(process.env.WORKFLOW_MOCK_AI,'true');
const base='http://127.0.0.1:4330',headers={Origin:base};
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({baseURL:base});
try {
  const email=`restored-recovery-${randomUUID()}@example.test`;
  const registered=await context.request.post('/api/auth/register',{headers,data:{name:'Synthetic recovery verification',email,password:'SyntheticFixture123!',organisationName:`Restored recovery ${randomUUID()}`}});
  assert.equal(registered.status(),201);
  const member=await prisma.organisationMember.findFirstOrThrow({where:{user:{email}}});
  const response=await context.request.post('/api/application-drafts',{headers,data:{applicationType:'HOUSEHOLDER_PLANNING',notes:'Synthetic extension'}});
  assert.equal(response.status(),201);const id=(await response.json()).draft.id;
  const ids:string[]=[];
  for(const name of ['Location Plan.pdf','Proposed Plans.pdf','Supporting Statement.pdf']) {
    const bytes=Buffer.from(`%PDF-1.4\nSynthetic transport recovery ${randomUUID()}\n%%EOF`);
    const data={filename:name,mimeType:'application/pdf',size:bytes.length};
    const a=await context.request.post(`/api/application-drafts/${id}/documents/upload-intent`,{headers,data});
    assert.equal(a.status(),201,await a.text()); const intent=await a.json();
    const b=await context.request.post(`/api/application-drafts/${id}/documents/upload-intent`,{headers,data});
    assert.equal((await b.json()).document.id,intent.document.id);
    assert.equal((await fetch(intent.upload.url,{method:'PUT',body:bytes,headers:{'content-type':'application/pdf'}})).ok,true);
    assert.equal((await context.request.post(`/api/application-drafts/${id}/documents/${intent.document.id}/finalise`,{headers})).status(),200);
    ids.push(intent.document.id);
  }
  await fetch('http://127.0.0.1:4331/__ai/control',{method:'POST',body:JSON.stringify({failures:{'Supporting Statement.pdf':1}})});
  const analyse=async(force=false)=> {
    const r=await context.request.post(`/api/application-drafts/${id}/analyse`,{headers,data:{force}});
    assert.equal(r.status(),200,await r.text());return(await r.json()).draft;
  };
  let draft=await analyse();
  assert.equal(draft.status,'NEEDS_REVIEW');
  assert.equal(draft.documents.find((d:any)=>d.originalFilename==='Supporting Statement.pdf').analysisStatus,'FALLBACK');
  await fetch('http://127.0.0.1:4331/__ai/control',{method:'POST',body:JSON.stringify({failures:{}})});
  draft=await analyse(true);
  assert.ok(draft.documents.every((d:any)=>d.analysisStatus==='SUCCESS'));
  assert.deepEqual(draft.documents.map((d:any)=>d.id).sort(),ids.sort());
  assert.equal(draft.review.client.firstName,'Anna');
  assert.equal(await prisma.applicationDraftDocument.count({where:{draftId:id}}),3);
  // Inject a second source of conflicting extracted evidence in this test schema.
  const location=await prisma.applicationDraftDocument.findFirstOrThrow({where:{draftId:id,originalFilename:'Location Plan.pdf'}});
  const proposed=await prisma.applicationDraftDocument.findFirstOrThrow({where:{draftId:id,originalFilename:'Proposed Plans.pdf'}});
  const audit=structuredClone(proposed.analysisResult) as any;
  audit.classification.extractedFacts.push({fieldKey:'site.buildingNumber',value:'148',certainty:'high',page:1,evidence:'Synthetic second document identifies site number 148'});
  await prisma.applicationDraftDocument.update({where:{id:proposed.id},data:{analysisResult:audit as Prisma.InputJsonValue}});
  draft=await analyse();
  assert.equal(draft.prepared.site.buildingNumber.status,'conflict');
  assert.equal(draft.prepared.site.buildingNumber.sources.length,2);
  const review={...draft.review,site:{...draft.review.site,buildingNumber:'149'}};
  const corrected=await context.request.patch(`/api/application-drafts/${id}`,{headers,data:{review,revision:draft.reviewRevision}});
  assert.equal(corrected.status(),200,await corrected.text());
  draft=await analyse(); assert.equal(draft.review.site.buildingNumber,'149');
  assert.equal(await prisma.documentProcessingJob.count({where:{organisationId:member.organisationId}}),0);
  const page=await context.newPage(); await page.goto(`/applications/${id}`);await page.waitForLoadState('networkidle');
  await expect(page.getByText('148',{exact:true}).first()).toBeAttached();
  await page.screenshot({path:'output/workflow/pdf-restoration/conflict-review.png',fullPage:true});
  await fs.writeFile('output/workflow/pdf-restoration/recovery-results.json',JSON.stringify({id,documentIds:ids,providerOutageReachedManualReview:true,reanalysisRecoveredClient:true,noDuplicateUploads:true,addressConflictSources:[location.id,proposed.id],manualAddressCorrectionKept:true,queueJobs:0},null,2));
  console.log('Provider outage/manual review, same-file reanalysis, duplicate protection, conflicting evidence and saved address correction passed.');
} finally {await context.close();await browser.close();await prisma.$disconnect();}

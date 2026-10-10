import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { chromium, expect } from '@playwright/test';
import { prisma } from '../src/lib/db/prisma';

assert.equal(new URL(process.env.DATABASE_URL!).searchParams.get('schema'), 'workflow_overhaul_preview_20261009');
const live = process.env.WORKFLOW_LIVE_AI === 'true';
const base = 'http://127.0.0.1:4330';
const output = 'output/workflow/pdf-restoration';
const extendedOnly = process.env.WORKFLOW_RESTORATION_EXTENDED_ONLY === 'true';
const evidence: Record<string, unknown> = { ...(extendedOnly ? JSON.parse(await fs.readFile(`${output}/mock-results.json`,'utf8')) : {}), live, legacyProcessingFlag: process.env.DOCUMENT_PROCESSING_ENABLED, provider: process.env.DOCUMENT_AI_PROVIDER, storage: live ? 'real hosted Supabase' : 'loopback fixture' };
const names = ['Location Plan.pdf', 'Proposed Plans.pdf', 'Supporting Statement.pdf'];
// Valid PDFs containing synthetic people and addresses; never customer documents.
function pdf(title: string, extra: string[] = []) {
  const lines = [
    'Site: 147 High Street, Glasgow, G1 1AA', 'Local authority: Glasgow City Council',
    'Project: 147 High Street extension; building warrant application',
    'Applicant: Ms Anna Campbell; email: anna@example.test; phone: 07483882299',
    'Applicant address is the same as the site address.',
    'Proposal: Construction of a single-storey rear extension',
    'Type of work: domestic alteration and extension; current and proposed use: dwelling',
    'Estimated value of work: GBP 25000; Drawing number AP-101 Revision A',
    ...extra,
  ];
  const escape = (v: string) => v.replace(/[\\()]/g, c => `\\${c}`);
  const stream = `BT /F1 14 Tf 40 790 Td (${escape(title)}) Tj /F1 11 Tf ${lines.map(v => `0 -22 Td (${escape(v)}) Tj`).join(' ')} ET\n0.8 0 0 RG 2 w 100 100 240 150 re S`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let content = '%PDF-1.4\n'; const offsets: number[] = [];
  objects.forEach((o,i) => { offsets.push(Buffer.byteLength(content)); content += `${i+1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(content);
  content += `xref\n0 6\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(content);
}
const buffers = names.map(name => ({ name, mimeType: 'application/pdf', buffer: pdf(name, [randomUUID()]) }));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const getDraft = async (context: any, id: string) => (await (await context.request.get(`/api/application-drafts/${id}`)).json()).draft;
const projection = (draft: any) => ({
  client: [draft.review.client.firstName,draft.review.client.lastName,draft.review.client.email],
  site: [draft.review.site.buildingNumber,draft.review.site.addressLine1,draft.review.site.townCity,draft.review.site.postcode],
  type: draft.review.selectedApplicationType, description: draft.review.application.description,
  documents: draft.documents.map((d: any) => [d.originalFilename,d.analysisStatus,d.documentType]).sort((a: string[],b: string[])=>a[0].localeCompare(b[0])),
});
async function register(origin: string) {
  const context = await browser.newContext({ baseURL: origin, reducedMotion: 'reduce' });
  const email = `restored-pdf-${randomUUID()}@example.test`;
  const response = await context.request.post('/api/auth/register', { headers: { Origin: origin }, data: { name: 'Synthetic PDF verification', email, password: 'SyntheticFixture123!', organisationName: `PDF verification ${randomUUID()}` } });
  assert.equal(response.status(),201,await response.text());
  const member = await prisma.organisationMember.findFirstOrThrow({ where: { user: { email } } });
  await prisma.organisationDefaults.create({ data: { organisationId: member.organisationId, practiceName: 'Fixture Architects', agentFirstName: 'Jane', agentLastName: 'Architect', agentEmail: 'agent@example.test', agentPhone: '07483882299', agentBuildingNumber: '10', agentAddressLine1: 'Office Street', agentTownCity: 'Glasgow', agentPostcode: 'G1 1AA' } });
  return {context,member};
}
async function happy(origin: string, lostResponse = false) {
  const {context,member} = await register(origin);
  const page = await context.newPage(); const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  let transfers=0, analysisRequests=0;
  page.on('request', r => { if(r.method()==='PUT') transfers++; });
  await page.route('**/analyse',async route => {
    analysisRequests++;
    if(lostResponse && analysisRequests===1) { await route.fetch(); await route.fulfill({status:504,contentType:'application/json',body:'{"error":"Synthetic lost response"}'}); }
    else await route.continue();
  });
  if(lostResponse) await page.route('**/api/application-drafts/*',async route => {
    if(route.request().method()==='GET' && analysisRequests===1) await route.fulfill({status:503,contentType:'application/json',body:'{"error":"Synthetic unavailable progress read"}'});
    else await route.continue();
  });
  await page.goto('/applications/new'); await page.waitForLoadState('networkidle');
  await page.locator('[data-file-input]').setInputFiles(buffers);
  await page.locator('select[name=applicationType]').selectOption('AUTO');
  await page.locator('textarea[name=notes]').fill('Building warrant application for a rear domestic extension');
  await page.locator('[data-submit]').click();
  await page.waitForURL(/\/applications\/(?!new)[^/]+$/, {timeout:180_000});
  if(lostResponse) {
    await expect(page.getByRole('alert')).toContainText('Synthetic lost response',{timeout:180_000});
    await page.getByRole('button',{name:'Retry preparation'}).click();
  }
  await expect.poll(async()=> (await getDraft(context,page.url().split('/').at(-1)!)).status,{timeout:180_000,intervals:[1000,2000]}).toMatch(/NEEDS_REVIEW|READY_TO_CREATE/);
  const id=page.url().split('/').at(-1)!; const draft=await getDraft(context,id);
  assert.equal(transfers,3); assert.equal(analysisRequests,lostResponse?2:1);
  assert.deepEqual(draft.documents.map((d:any)=>d.analysisStatus),['SUCCESS','SUCCESS','SUCCESS']);
  assert.equal(draft.review.client.firstName,'Anna'); assert.equal(draft.review.client.lastName,'Campbell');
  assert.equal(draft.review.client.email,'anna@example.test');
  assert.equal(draft.review.site.buildingNumber,'147'); assert.equal(draft.review.site.addressLine1,'High Street');
  assert.equal(draft.review.site.postcode.replace(/\s/g,''),'G11AA');
  assert.equal(draft.review.selectedApplicationType,'BUILDING_WARRANT');
  assert.deepEqual(Object.fromEntries(draft.documents.map((d:any)=>[d.originalFilename,d.documentType])),{'Location Plan.pdf':'LOCATION_PLAN','Proposed Plans.pdf':'PROPOSED_DRAWING','Supporting Statement.pdf':'SUPPORTING_DOCUMENT'});
  assert.match(draft.review.application.description,/extension/i); assert.deepEqual(errors,[]);
  assert.equal(await prisma.documentProcessingJob.count({where:{organisationId:member.organisationId}}),0);
  if(live) {
    assert.equal(new URL(process.env.SUPABASE_URL!).protocol,'https:');
    const analysis=await prisma.applicationDraftDocument.findMany({where:{draftId:id},select:{originalFilename:true,analysisProvider:true,analysisModel:true,analysisStatus:true}});
    assert.ok(analysis.every(d=>d.analysisProvider==='gemini'));
    evidence.realAnalysis=analysis;
  }
  for(const d of draft.documents) { const opened=await context.request.get(d.previewUrl); assert.equal(opened.status(),200); assert.ok((await opened.body()).subarray(0,5).equals(Buffer.from('%PDF-'))); }
  await page.screenshot({path:`${output}/${origin.endsWith('4332')?'baseline':live?'live':'restored'}${lostResponse?'-retry':''}.png`,fullPage:true});
  evidence[origin.endsWith('4332')?'baseline':lostResponse?'lostResponse':'restored']={id,transfers,analysisRequests,extraction:projection(draft),queueJobs:0};
  console.log(`${origin} select -> upload -> classify -> extract -> review: ${analysisRequests} awaited request(s), no queue.`);
  return {context,page,member,draft};
}
async function analyse(context:any,id:string,force=false) {
  const r=await context.request.post(`/api/application-drafts/${id}/analyse`,{headers:{Origin:base},data:{force}});
  assert.equal(r.status(),200,await r.text()); return (await r.json()).draft;
}
try {
  await fs.mkdir(output,{recursive:true});
  if(!live && !extendedOnly) {
    const baseline=await happy('http://127.0.0.1:4332');
    const current=await happy(base);
    assert.deepEqual(projection(current.draft),projection(baseline.draft),'restoration matches original bd75264 classification, extraction and automatic application routing');
    await baseline.context.close(); await current.context.close();
    const retry=await happy(base,true); await retry.context.close();
  }
  const current=await happy(base); const {context,page,member}=current; let draft=current.draft;
  // Existing-client matching uses the improved matching service with original AI facts.
  const client=await prisma.client.create({data:{organisationId:member.organisationId,name:'Anna Campbell',title:'Ms',firstName:'Anna',lastName:'Campbell',email:'anna@example.test',phone:'07483882299',buildingNumber:'147',addressLine1:'High Street',townCity:'Glasgow',postcode:'G1 1AA'}});
  await prisma.applicationDraft.update({where:{id:draft.id},data:{confirmedData:Prisma.JsonNull}});
  draft=await analyse(context,draft.id);
  assert.equal(draft.review.clientMode,'existing'); assert.equal(draft.review.existingClientId,client.id);
  evidence.existingClient={id:client.id,matched:true};
  await page.reload(); await page.waitForLoadState('networkidle');
  await page.locator('summary').filter({hasText:/^Documents/}).click();
  await page.getByRole('checkbox',{name:'Show all documents'}).check();
  await page.getByRole('button',{name:'Change category for Supporting Statement.pdf',exact:true}).click();
  await page.getByRole('combobox',{name:'Change category for Supporting Statement.pdf',exact:true}).selectOption('ELEVATION');
  await expect.poll(async()=> (await getDraft(context,draft.id)).documents.find((d:any)=>d.originalFilename==='Supporting Statement.pdf').documentType).toBe('ELEVATION');
  draft=await getDraft(context,draft.id);
  const review={...draft.review,project:{...draft.review.project,internalReference:'RESTORED-PDF-VERIFIED'},site:{...draft.review.site,planningAuthority:'Glasgow City Council',buildingStandardsAuthority:'Glasgow City Council',authorityVerification:'confirmed'},application:{...draft.review.application,currentUse:'Dwelling',proposedUse:'Dwelling',estimatedValue:25000},confirmations:{...draft.review.confirmations,applicantIsOwner:true},documents:draft.review.documents.map((d:any)=>({...d,documentStatus:'APPROVED'}))};
  const saved=await context.request.patch(`/api/application-drafts/${draft.id}`,{headers:{Origin:base},data:{review,revision:draft.reviewRevision}});
  assert.equal(saved.status(),200,await saved.text());
  assert.deepEqual((await saved.json()).issues,[]);
  draft=await analyse(context,draft.id,true);
  assert.equal(draft.documents.find((d:any)=>d.originalFilename==='Supporting Statement.pdf').documentType,'ELEVATION','manual classification survives reanalysis');
  assert.equal(draft.review.project.internalReference,'RESTORED-PDF-VERIFIED','saved corrections survive reanalysis');
  // A newer upload may clear preparation but must keep saved client/site values.
  await page.reload(); await page.waitForLoadState('networkidle');
  await page.locator('input[type=file]').setInputFiles({name:'Extra Supporting.pdf',mimeType:'application/pdf',buffer:pdf('SUPPORTING DOCUMENT',[randomUUID()])});
  await expect.poll(async()=> (await getDraft(context,draft.id)).documents.length,{timeout:60000}).toBe(4);
  await expect.poll(async()=> (await getDraft(context,draft.id)).status,{timeout:180000}).toMatch(/NEEDS_REVIEW|READY_TO_CREATE/);
  draft=await getDraft(context,draft.id); assert.equal(draft.review.project.internalReference,'RESTORED-PDF-VERIFIED'); assert.equal(draft.documents.find((d:any)=>d.originalFilename==='Supporting Statement.pdf').documentType,'ELEVATION');
  await page.reload(); await page.waitForLoadState('networkidle');
  await page.getByRole('button',{name:'Create Project',exact:true}).click();
  await page.waitForURL(/\/projects\/[^/?]+\?/,{timeout:60000});
  const committed=await getDraft(context,draft.id); const projectId=committed.result.projectId;
  assert.equal(committed.status,'COMMITTED');
  const docs=await prisma.projectDocument.findMany({where:{projectId,organisationId:member.organisationId}});
  assert.equal(docs.length,4); assert.equal(docs.find(d=>d.originalName==='Supporting Statement.pdf')!.type,'ELEVATION');
  for(const d of docs) assert.equal((await context.request.get(`/api/documents/${d.id}`)).status(),200);
  await page.goto(`/documents/upload?projectId=${projectId}`); await page.waitForLoadState('networkidle');
  await page.locator('input[type=file]').setInputFiles([{name:'Extra Proposed Plans.pdf',mimeType:'application/pdf',buffer:pdf('PROPOSED FLOOR PLAN',[randomUUID()])},{name:'Extra Supporting.pdf',mimeType:'application/pdf',buffer:pdf('SUPPORTING DOCUMENT',[randomUUID()])}]);
  await page.getByRole('button',{name:'Upload and review sorting'}).click();
  await page.waitForURL(/\/files\/sort\//,{timeout:180000});
  await page.locator('[data-document-type]').last().selectOption('ELEVATION');
  await page.getByRole('button',{name:'Save document sorting'}).click();
  await page.waitForURL(new RegExp(`/projects/${projectId}`),{timeout:60000});
  assert.equal(await prisma.projectDocument.count({where:{projectId}}),6);
  assert.equal(await prisma.documentProcessingJob.count({where:{organisationId:member.organisationId}}),0);
  evidence.created={projectId,documents:6,storedOriginalsAccessible:true,manualClassificationPreserved:true,additionalApplicationAndProjectFiles:true};
  await page.screenshot({path:`${output}/${live?'live-':'mock-'}project.png`,fullPage:true});
  console.log('Existing-client matching, manual correction, reanalysis, application additions, project creation and existing-project sorting passed.');
  // Previously uploaded data can be reanalysed directly using existing storage keys.
  const existing=docs[0]; const again=await context.request.post(`/api/documents/${existing.id}/analysis`,{headers:{Origin:base},data:{}});
  assert.equal(again.status(),200,await again.text()); assert.equal((await again.json()).document.id,existing.id);
  const foreign=await register(base); const denied=await foreign.context.request.post(`/api/application-drafts/${draft.id}/analyse`,{headers:{Origin:base},data:{}}); assert.equal(denied.status(),404); await foreign.context.close();
  evidence.permissionIsolation=true;
  await context.close();
} finally {
  await fs.writeFile(`${output}/${live?'live':'mock'}-results.json`,JSON.stringify(evidence,null,2));
  await browser.close(); await prisma.$disconnect();
}

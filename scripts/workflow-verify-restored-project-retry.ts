import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import {prisma} from '../src/lib/db/prisma';
assert.equal(new URL(process.env.DATABASE_URL!).searchParams.get('schema'),'workflow_overhaul_preview_20261009');
const evidence=JSON.parse(await fs.readFile('output/workflow/pdf-restoration/mock-results.json','utf8'));
const document=await prisma.projectDocument.findFirstOrThrow({where:{projectId:evidence.created.projectId,sortSource:'MANUAL'},include:{project:{include:{organisation:{include:{members:{include:{user:true}}}}}}}});
const user=document.project.organisation.members[0].user;assert.match(user.email,/^restored-pdf-.*@example.test$/);
const count=await prisma.projectDocument.count({where:{projectId:document.projectId}});
await prisma.projectDocument.update({where:{id:document.id},data:{analysisStatus:'PROVIDER_UNAVAILABLE'}});
const browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({baseURL:'http://127.0.0.1:4330'});
try {
  assert.equal((await context.request.post('/api/auth/login',{headers:{Origin:'http://127.0.0.1:4330'},data:{email:user.email,password:'SyntheticFixture123!'}})).status(),200);
  const page=await context.newPage();await page.goto(`/projects/${document.projectId}#documents`);await page.waitForLoadState('networkidle');
  await page.locator('[data-documents-expand]').click();
  const control=async(failures:Record<string,number>)=>fetch('http://127.0.0.1:4331/__ai/control',{method:'POST',body:JSON.stringify({failures})});
  await control({[document.originalName]:1});
  await page.getByRole('button',{name:`Retry analysis of ${document.originalName}`,exact:true}).click();
  await page.waitForLoadState('networkidle');
  if(await page.locator('[data-documents-expand]').getAttribute('aria-expanded')==='false') await page.locator('[data-documents-expand]').click();
  await expect(page.getByRole('button',{name:`Retry analysis of ${document.originalName}`,exact:true})).toBeVisible();
  await control({});await page.getByRole('button',{name:`Retry analysis of ${document.originalName}`,exact:true}).click();
  await expect.poll(async()=> (await prisma.projectDocument.findUniqueOrThrow({where:{id:document.id}})).analysisStatus,{timeout:30000}).toBe('SUCCESS');
  const after=await prisma.projectDocument.findUniqueOrThrow({where:{id:document.id}});assert.equal(after.type,document.type);assert.equal(after.sortSource,'MANUAL');
  assert.equal(await prisma.projectDocument.count({where:{projectId:document.projectId}}),count);
  evidence.projectRetryAfterProviderFailure={sameDocumentId:document.id,manualCategoryKept:true,buttonRemainsOnFailure:true,noDuplicateDocuments:true};
  await fs.writeFile('output/workflow/pdf-restoration/mock-results.json',JSON.stringify(evidence,null,2));
  console.log('Project retry stays available after provider failure and updates the same document while preserving its manual category.');
} finally {await context.close();await browser.close();await prisma.$disconnect();}

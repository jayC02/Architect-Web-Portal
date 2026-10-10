import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium} from '@playwright/test';
import {prisma} from '../src/lib/db/prisma';
assert.equal(new URL(process.env.DATABASE_URL!).searchParams.get('schema'),'workflow_overhaul_preview_20261009');
const previous=JSON.parse(await fs.readFile('output/workflow/hobby/results.json','utf8'));
const project=await prisma.project.findUniqueOrThrow({where:{id:previous.created.projectId},include:{organisation:{include:{members:{include:{user:true}}}}}});
const user=project.organisation.members.find(member=>/^hobby-.*@example\.test$/.test(member.user.email))!.user;
assert.ok(user,'Only the older synthetic Hobby test organisation is allowed');
const fields={id:true,storageKey:true,storageUrl:true,fileName:true,originalName:true,type:true,status:true} as const;
const original=await prisma.projectDocument.findMany({where:{projectId:project.id},select:fields,orderBy:{id:'asc'}});
assert.ok(original.length>=3);
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({baseURL:'http://127.0.0.1:4330'});
try {
  const login=await context.request.post('/api/auth/login',{headers:{Origin:'http://127.0.0.1:4330'},data:{email:user.email,password:'SyntheticFixture123!'}});
  assert.equal(login.status(),200);
  for(const document of original) {
    const r=await context.request.get(`/api/documents/${document.id}`);
    assert.equal(r.status(),200,await r.text());assert.ok((await r.body()).subarray(0,5).equals(Buffer.from('%PDF-')));
  }
  const after=await prisma.projectDocument.findMany({where:{id:{in:original.map(d=>d.id)}},select:fields,orderBy:{id:'asc'}});
  assert.deepEqual(after,original,'PDF records created before restoration are unchanged');
  const source=await prisma.projectDocument.findUniqueOrThrow({where:{id:original[0].id}});
  const legacy=await prisma.projectDocument.create({data:{organisationId:project.organisationId,projectId:project.id,uploadedById:user.id,fileName:source.fileName,originalName:'Synthetic legacy URL access check.pdf',mimeType:source.mimeType,sizeBytes:source.sizeBytes,storageUrl:`/uploads/${source.storageKey}`,storageKey:null}});
  const opened=await context.request.get(`/api/documents/${legacy.id}`);
  assert.equal(opened.status(),200);assert.ok((await opened.body()).subarray(0,5).equals(Buffer.from('%PDF-')));
  await fs.writeFile('output/workflow/pdf-restoration/existing-pdfs-results.json',JSON.stringify({olderProjectId:project.id,originalDocumentIds:original.map(d=>d.id),originalMetadataUnchanged:true,originalStoredPdfsAccessible:true,legacyUrlDocumentId:legacy.id,legacyUrlAccessible:true},null,2));
  console.log('Previously uploaded synthetic PDFs remain accessible and unchanged; legacy URL-only storage also opens.');
} finally {await context.close();await browser.close();await prisma.$disconnect();}

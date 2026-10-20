import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
import tailwindConfig from '../tailwind.config.mjs';
import {chromium} from 'playwright';
import {clientReviewFixture} from './fixtures/client-applicant-review.ts';

// Real portal components; isolated HTTP/API doubles; no customer data or government writes.
const output=path.resolve('output/portal-review-reliability');
await fs.mkdir(output,{recursive:true});
await build({entryPoints:{harness:'tests/fixtures/client-applicant-review-harness.tsx',setup:'tests/fixtures/agent-setup-reliability-harness.tsx'},outdir:output,bundle:true,format:'esm',platform:'browser',jsx:'automatic',alias:{'@':path.resolve('src')},logLevel:'silent',plugins:[{
 name:'tailwind',setup(builder){builder.onLoad({filter:/global\.css$/},async args=>({contents:(await postcss([tailwind(tailwindConfig)]).process(await fs.readFile(args.path,'utf8'),{from:args.path})).css,loader:'css'}));},
}]});
const server=http.createServer(async(req,res)=>{
 const file=req.url?.split('?')[0];
 if(['/harness.js','/harness.css','/setup.js','/setup.css'].includes(file)){
  res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':'text/css');res.end(await fs.readFile(path.join(output,file.slice(1))));
 }else{const bundle=file==='/agent-setup'?'setup':'harness';res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html lang="en"><head><title>Portal reliability checks</title><link rel="stylesheet" href="/${bundle}.css"></head><body><main id="root" style="max-width:1100px;margin:32px auto"></main><script type="module" src="/${bundle}.js"></script></body></html>`);}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
let draft,failSave,failAnalyse,transientUploads,actions,intents,patchDelay,failFinalise,uploadNames,loseRemoveResponse;
let setupAgents=[],setupPolls=0;
const errors=[];const checks=[];
page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
await page.route('**/api/**',async route=>{
 const request=route.request(),url=new URL(request.url()),method=request.method();
 const reply=(status,json)=>route.fulfill({status,json});
 if(url.pathname==='/api/settings/desktop-agents'){setupPolls++;return reply(200,{agents:setupAgents.map(agent=>({...agent,lastSeenAt:new Date().toISOString()}))});}
 if(url.pathname==='/api/settings/desktop-agents/setup')return reply(201,{release:{version:'4.2.7',downloadUrl:'/downloads/test-installer.exe',signed:true},expiresAt:new Date(Date.now()+600000).toISOString()});
 if(url.pathname==='/api/clients')return reply(200,{clients:[],nextCursor:null});
 if(url.pathname.endsWith('/address-lookup'))return reply(200,{status:'not_configured',fields:{}});
 if(url.pathname==='/api/application-drafts/concept-a-review'){
  if(method==='PATCH'){
   if(patchDelay)await new Promise(resolve=>setTimeout(resolve,patchDelay));
   if(failSave)return reply(503,{error:'Save unavailable'});
   const review=request.postDataJSON().review;
   const ids=new Set(draft.documents.map(document=>document.id));
   if(review.documents.length!==ids.size||review.documents.some(document=>!ids.has(document.id)))return reply(400,{error:'Review every document in this application draft.'});
   draft.review=review;actions.push('save');return reply(200,{draft,issues:[]});
  }
  return reply(200,{draft});
 }
 if(url.pathname.endsWith('/analyse')){
  actions.push(`analyse:${draft.review.client.email}`);
  return failAnalyse?reply(503,{error:'Analysis temporarily unavailable'}):reply(200,{draft});
 }
 if(url.pathname.endsWith('/upload-intent')){
  const input=request.postDataJSON();intents.push(input);actions.push('upload');
  if(transientUploads-->0)return reply(503,{error:'Temporary storage failure'});
  if(failFinalise&&input.filename==='Broken.pdf'){
   if(!draft.documents.some(doc=>doc.id==='broken')){
    draft.documents.push({...draft.documents[0],id:'broken',originalFilename:'Broken.pdf',uploadStatus:'UPLOADING',documentStatus:'IN_REVIEW'});
    draft.review.documents.push({...draft.review.documents[0],id:'broken',documentStatus:'IN_REVIEW'});
   }
   return reply(200,{document:{id:'broken'},upload:null});
  }
  uploadNames.set('new-document',input.filename);
  return reply(200,{document:{id:'new-document'},upload:null});
 }
 if(url.pathname.endsWith('/finalise')){
  if(url.pathname.endsWith('/broken/finalise'))return reply(400,{error:'This PDF was incomplete. Add it again.'});
  if(!draft.documents.some(doc=>doc.id==='new-document')){
   draft.documents.push({...draft.documents[0],id:'new-document',originalFilename:uploadNames.get('new-document')});
   draft.review.documents.push({...draft.review.documents[0],id:'new-document'});
  }
  draft.status='UPLOADING';actions.push('finalise');return reply(200,{ok:true});
 }
 if(method==='DELETE'&&url.pathname.endsWith('/documents/location-plan')){
  actions.push(`remove:${draft.review.client.email}`);draft.documents=[];draft.review.documents=[];draft.status='UPLOADING';
  if(loseRemoveResponse)return route.abort('failed');
  return reply(200,{ok:true});
 }
 return reply(404,{error:`Unexpected fixture request ${method} ${url.pathname}`});
});
const email=()=>page.locator('.client-review').getByRole('textbox',{name:'client Email',exact:true});
const waitFor=async(predicate,message)=>{for(let i=0;i<150;i++){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,30));}throw new Error(message);};
const open=async()=>{
 draft=clientReviewFixture();failSave=false;failAnalyse=false;failFinalise=false;loseRemoveResponse=false;transientUploads=0;patchDelay=0;actions=[];intents=[];uploadNames=new Map();
 await page.goto(`http://127.0.0.1:${server.address().port}`);await email().waitFor();
 await page.waitForTimeout(750);
 await page.locator('summary').filter({hasText:'Documents'}).click();
 await page.getByRole('checkbox',{name:'Show all documents',exact:true}).check();
 actions=[];
};
const check=(label,result)=>{assert.ok(result,label);checks.push(label);};
try{
 await open();patchDelay=180;
 await email().fill('before-analysis@example.test');
 await page.getByRole('button',{name:'Analyse again',exact:true}).click();
 await waitFor(()=>actions.some(action=>action.startsWith('analyse:')),'analysis did not start');
 check('Reanalysis flushes the most recent edit before starting',actions.indexOf('save')<actions.indexOf('analyse:before-analysis@example.test'));
 await waitFor(async()=>await email().isEnabled(),'review did not unlock');
 check('Reanalysis preserves the edit on screen',await email().inputValue()==='before-analysis@example.test');

 await open();patchDelay=250;
 const firstSave=page.waitForRequest(request=>request.method()==='PATCH'&&request.url().endsWith('/concept-a-review'));
 await email().fill('first-edit@example.test');await firstSave;
 await email().fill('latest-edit@example.test');
 await waitFor(()=>draft.review.client.email==='latest-edit@example.test','latest edit was not saved after the earlier response');
 check('An earlier autosave response does not replace newer typing',await email().inputValue()==='latest-edit@example.test');

 await open();patchDelay=180;
 const relationshipSave=page.waitForRequest(request=>request.method()==='PATCH'&&request.url().endsWith('/concept-a-review'));
 await page.locator('.client-review').getByRole('radio',{name:'No, a different applicant'}).check();await relationshipSave;
 await page.locator('.client-review').getByRole('radio',{name:'Yes, use the client'}).check();
 await email().fill('relationship-edit@example.test');
 await waitFor(()=>draft.review.client.email==='relationship-edit@example.test','typing after a relationship change was not saved');
 check('Slow relationship saves retain the latest email and same-client applicant',await email().inputValue()==='relationship-edit@example.test'&&!draft.review.applicantDifferentFromClient&&draft.review.applicant.email==='relationship-edit@example.test');

 await open();
 await page.evaluate(()=>{
  const decode=Response.prototype.json;
  Response.prototype.json=function(){
   return decode.call(this).then(payload=>{
    if(payload?.draft?.review?.client?.email==='acknowledged@example.test'){
     // Interleave a real input event after acknowledgement, before React's
     // pending response render/effect can replace the controlled form values.
     let remaining=4;
     const type=()=>{
      if(--remaining>0){queueMicrotask(type);return;}
      const field=document.querySelector('[aria-label="client Email"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,'typed-after-ack@example.test');
      field.dispatchEvent(new Event('input',{bubbles:true}));
      window.__interleavedTypingFired=true;
     };
     queueMicrotask(type);
    }
    return payload;
   });
  };
 });
 await email().fill('acknowledged@example.test');
 await waitFor(()=>page.evaluate(()=>window.__interleavedTypingFired),'interleaved input did not run');
 await waitFor(()=>draft.review.client.email==='typed-after-ack@example.test','save acknowledgement replaced newer input before synchronization');
 check('Typing between save acknowledgement and form synchronization survives',await email().inputValue()==='typed-after-ack@example.test');

 await open();failSave=true;patchDelay=250;
 await page.getByRole('button',{name:'Change category for Proposed plans.pdf',exact:true}).click();
 const categorySave=page.waitForRequest(request=>request.method()==='PATCH'&&request.url().endsWith('/concept-a-review'));
 await page.getByRole('combobox',{name:'Change category for Proposed plans.pdf',exact:true}).selectOption('OTHER');
 await categorySave;await email().fill('edited-during-category-save@example.test');
 await waitFor(async()=>await page.getByRole('combobox',{name:'Change category for Proposed plans.pdf',exact:true}).isEnabled(),'failed category save did not finish');
 check('A failed category save preserves edits entered in other fields',await email().inputValue()==='edited-during-category-save@example.test');
 check('A failed category save restores the previous category',await page.getByRole('combobox',{name:'Change category for Proposed plans.pdf',exact:true}).inputValue()==='LOCATION_PLAN');
 failSave=false;
 await page.getByRole('button',{name:'Analyse again',exact:true}).click();
 await waitFor(()=>actions.some(action=>action==='analyse:edited-during-category-save@example.test'),'retained edits could not be saved after the category failure');
 check('Recovered category failure saves the retained edits on retry',draft.review.client.email==='edited-during-category-save@example.test'&&draft.review.documents[0].documentType==='LOCATION_PLAN');

 await open();failSave=true;
 await email().fill('unsaved@example.test');await page.getByRole('button',{name:'Analyse again',exact:true}).click();
 await page.getByText('Save unavailable',{exact:true}).waitFor();
 check('A failed save prevents reanalysis',!actions.some(action=>action.startsWith('analyse:')));
 check('A failed save leaves the latest edit available',await email().inputValue()==='unsaved@example.test'&&await email().isEnabled());

 await open();failAnalyse=true;
 await page.getByRole('button',{name:'Analyse again',exact:true}).click();await page.getByText('Analysis temporarily unavailable',{exact:true}).waitFor();
 check('A failed analysis request leaves an editable review',await email().isEnabled());

 await open();await email().fill('before-remove@example.test');
 await page.getByRole('button',{name:'Remove Proposed plans.pdf',exact:true}).click();
 await waitFor(()=>actions.some(action=>action.startsWith('remove:')),'remove did not complete');
 check('Removing a document first saves current details',actions.indexOf('save')<actions.indexOf('remove:before-remove@example.test'));
 await waitFor(async()=>await email().isEnabled(),'review disappeared after document removal');
 check('Changing documents retains the review controls',await email().inputValue()==='before-remove@example.test');

 await open();loseRemoveResponse=true;await email().fill('lost-response@example.test');
 await page.getByRole('button',{name:'Remove Proposed plans.pdf',exact:true}).click();
 await waitFor(()=>actions.some(action=>action.startsWith('remove:')),'remove did not reach the server');
 await waitFor(async()=>await email().isEnabled(),'review did not unlock after lost response');
 check('A successful removal with a lost response reconciles the actual document list',await page.getByRole('button',{name:'Remove Proposed plans.pdf',exact:true}).count()===0);
 check('Lost removal responses preserve saved edits',await email().inputValue()==='lost-response@example.test');
 await email().fill('after-recovery@example.test');
 await waitFor(()=>draft.review.client.email==='after-recovery@example.test','editing could not resume after recovering the lost response');
 check('Further edits save against the reconciled document list',draft.review.documents.length===0);

 await open();failSave=true;await email().fill('keep-me@example.test');
 await page.getByRole('button',{name:'Remove Proposed plans.pdf',exact:true}).click();await page.getByText('Save unavailable',{exact:true}).waitFor();
 check('A failed save prevents document removal',!actions.some(action=>action.startsWith('remove:')));

 await open();transientUploads=1;await email().fill('before-upload@example.test');
 const buffer=Buffer.from('%PDF-new-test');
 await page.locator('input[type=file]').setInputFiles({name:'New plan.pdf',mimeType:'',buffer});
 await waitFor(()=>actions.includes('finalise'),'upload did not recover');
 await waitFor(async()=>await email().isEnabled(),'upload did not unlock');
 check('Adding a PDF first saves current edits',actions.indexOf('save')<actions.indexOf('upload')&&draft.review.client.email==='before-upload@example.test');
 check('Valid PDFs with no browser MIME type use application/pdf',intents.every(input=>input.mimeType==='application/pdf'));
 check('A transient upload failure is retried automatically',intents.length===2);
 check('Retries send a stable content hash',intents.every(input=>input.clientSha256===createHash('sha256').update(buffer).digest('hex')));
 await page.screenshot({path:path.join(output,'review-after-document-change.png'),fullPage:true});

 await open();failFinalise=true;await email().fill('partial-package@example.test');
 await page.locator('input[type=file]').setInputFiles([
  {name:'Good.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-good')},
  {name:'Broken.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-bad')},
 ]);
 await page.getByText('This PDF was incomplete. Add it again.',{exact:true}).waitFor();
 await waitFor(async()=>await email().isEnabled(),'partial upload did not finish');
 check('A partial upload reconciles completed and unfinished files on screen',await page.getByRole('link',{name:'Good.pdf',exact:true}).isVisible()&&await page.getByRole('link',{name:'Broken.pdf',exact:true}).isVisible());
 check('Incomplete uploads block project creation',await page.getByRole('button',{name:'Create Project',exact:true}).isDisabled());
 check('Partial upload failure preserves the latest client details',await email().inputValue()==='partial-package@example.test');

 const remote={id:'other-device',machineName:'Other computer',agentVersion:'4.2.7',connected:true,usable:true,revokedAt:null,lastSeenAt:null,operatingState:'READY'};
 setupAgents=[remote];setupPolls=0;
 await page.route('**/downloads/test-installer.exe',route=>route.fulfill({status:200,headers:{'content-disposition':'attachment; filename="test-installer.exe"'},body:'isolated-test'}));
 await page.goto(`http://127.0.0.1:${server.address().port}/agent-setup`);
 await page.getByRole('button',{name:'Download & connect Agent',exact:true}).click();
 await waitFor(()=>setupPolls>=2,'setup did not poll');
 check('An already connected remote Agent cannot falsely complete this installation',await page.getByText('Connecting this computer...',{exact:true}).isVisible());
 setupAgents.push({...remote,id:'new-device',machineName:'New computer'});
 await page.getByText('Connected and ready',{exact:true}).waitFor();
 check('A newly connected installation completes setup',await page.getByText(/New computer · Agent/).isVisible());

 setupAgents=[{...remote,id:'old-device',connected:false,usable:false}];setupPolls=0;
 await page.goto(`http://127.0.0.1:${server.address().port}/agent-setup?offline=1`);
 await page.getByRole('button',{name:'Download installer',exact:true}).click();
 await waitFor(()=>setupPolls>=1,'replacement setup did not start');
 setupAgents.push({...remote,id:'replacement-device',machineName:'Replacement computer'});
 await page.getByText('Connected and ready',{exact:true}).waitFor();
 check('A replacement computer can connect when the previous Agent is offline',await page.getByText(/Replacement computer · Agent/).isVisible());
 assert.deepEqual(errors,[]);console.log(JSON.stringify({checks:checks.length,passed:checks,browserErrors:errors},null,2));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}

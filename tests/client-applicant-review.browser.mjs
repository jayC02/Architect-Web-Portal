import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
import tailwindConfig from '../tailwind.config.mjs';
import { chromium } from 'playwright';
import { clientReviewFixture, savedClient } from './fixtures/client-applicant-review.ts';
import { normaliseDraftAddresses } from '../src/lib/addresses/draft-address.ts';
import { evaluateClientApplicationDraftReadiness } from '../src/lib/application-draft-readiness.ts';
import { applicationDraftReviewSchema } from '../src/lib/validation/application-draft.ts';

const output = path.resolve('output/client-applicant-concepts');
await fs.mkdir(output,{recursive:true});
await build({entryPoints:['tests/fixtures/client-applicant-review-harness.tsx'],outdir:output,entryNames:'harness',bundle:true,format:'esm',platform:'browser',jsx:'automatic',alias:{'@':path.resolve('src')},logLevel:'silent',plugins:[{
  name:'tailwind-before-css-bundle',setup(build){build.onLoad({filter:/global\.css$/},async(args)=>({contents:(await postcss([tailwind(tailwindConfig)]).process(await fs.readFile(args.path,'utf8'),{from:args.path})).css,loader:'css'}));},
}]});
const html='<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Client review verification</title><link rel="stylesheet" href="/harness.css"></head><body><main id="root" style="max-width:1110px;margin:auto;padding:32px 20px"></main><script type="module" src="/harness.js"></script></body></html>';
const server=http.createServer(async(req,res)=>{
  const file=req.url?.split('?')[0];
  if(file==='/harness.js'||file==='/harness.css'){res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':'text/css');res.end(await fs.readFile(path.join(output,file.slice(1))));}
  else{res.setHeader('Content-Type','text/html');res.end(html);}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
let records=[], delay=0, patches=[], failSave=false, failedLookup=false;
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
await page.route('**/api/clients?*',async route=>{
  if(delay)await new Promise(r=>setTimeout(r,delay));
  const q=new URL(route.request().url()).searchParams;
  const clients=q.has('clientId')?records.filter(r=>r.id===q.get('clientId')):records.filter(r=>`${r.name} ${r.email}`.toLowerCase().includes((q.get('q')||'').toLowerCase()));
  await route.fulfill({status:failedLookup?503:200,json:failedLookup?{error:'Directory unavailable'}:{clients}});
});
await page.route('**/api/application-drafts/concept-a-review',async route=>{
  const data=route.request().postDataJSON();
  if(failSave){await route.fulfill({status:503,json:{error:'Save unavailable'}});return;}
  const parsed=applicationDraftReviewSchema.safeParse(data.review);
  if(!parsed.success){await route.fulfill({status:400,json:{error:'Enter a valid email address.'}});return;}
  const review=normaliseDraftAddresses(parsed.data);
  patches.push(review);
  const draft=clientReviewFixture();draft.review=review;draft.issues=evaluateClientApplicationDraftReadiness(review);
  await route.fulfill({json:{draft,issues:draft.issues}});
});
const client=page.locator('.client-review');
const input=label=>client.getByRole('textbox',{name:`client ${label}`,exact:true});
const open=async(state,list=[],options={})=>{records=list;delay=options.delay||0;failedLookup=!!options.failedLookup;failSave=false;patches=[];await page.goto(`${url}?state=${state}`);await client.waitFor();};
const waitFor=async(predicate,message)=>{for(let i=0;i<100;i++){if(await predicate())return;await new Promise(r=>setTimeout(r,30));}throw new Error(message);};
const checks=[];
const check=(label,condition)=>{assert.ok(condition,label);checks.push(label);};
try{
  await open('auto',[savedClient]);
  await waitFor(()=>patches.some(p=>p.existingClientId===savedClient.id),'automatic match was not saved');
  check('Unique exact name automatically links the saved client',await input('Email').inputValue()===savedClient.email);
  check('Saved record uses its own address',patches.at(-1).clientAddressSameAsSite===false&&patches.at(-1).client.buildingNumber==='24');
  await client.screenshot({path:path.join(output,'implemented-auto-desktop.png')});
  await open('default',[savedClient,{...savedClient,id:'default-client',name:'Default Client',email:'default@example.test'}]);
  await waitFor(()=>patches.some(p=>p.existingClientId==='default-client'&&p.client.email==='default@example.test'),'default client was not hydrated');
  check('Existing default ID takes precedence over another name match',await input('Client name').inputValue()==='Default Client');
  await client.getByRole('button',{name:'Enter a new client',exact:true}).click();
  await waitFor(()=>patches.some(p=>p.clientMode==='create'&&p.existingClientId===null),'could not deliberately replace the default client');
  check('A default saved client can be deliberately replaced with a new client',await input('Client name').inputValue()==='');
  await open('complete',[savedClient,{...savedClient,id:'duplicate',email:'other@example.test'}]);
  await client.getByText('More than one saved client has this name. Choose the correct client.').waitFor();
  check('Duplicate names are not automatically linked',!patches.some(p=>p.clientMode==='existing'));
  await open('complete',[{...savedClient,email:'different@example.test'}]);
  await client.getByText('A saved client has this name. Review the differing details before choosing.').waitFor();
  check('Conflicting email is not silently replaced',await input('Email').inputValue()==='laura@example.test');
  await client.getByRole('button',{name:'Review matches'}).click();
  await client.locator('.cr-result').click();
  await client.getByText('These details differ',{exact:true}).waitFor();
  await client.getByRole('button',{name:'Use this saved client',exact:true}).click();
  await waitFor(()=>patches.some(p=>p.client.email==='different@example.test'),'explicit conflict selection was not saved');
  check('Explicit conflict selection reuses the saved record',patches.at(-1).clientMode==='existing');
  await open('missing');
  await client.getByRole('button',{name:'Save and continue'}).click();
  check('Missing email is highlighted',await input('Email').getAttribute('aria-invalid')==='true');
  await input('Email').fill('new@example.test');
  await client.getByRole('button',{name:'Use site address'}).click();
  await client.getByRole('button',{name:'Save and continue'}).click();
  await waitFor(()=>patches.some(p=>p.client.email==='new@example.test'&&p.clientAddressSameAsSite),'completion not saved');
  check('Continue opens the next existing section',await page.locator('details').filter({has:page.locator('summary').filter({hasText:'Agent and practice'})}).getAttribute('open')!==null);
  await open('complete');
  await input('Email').fill('invalid-email');
  await client.getByRole('button',{name:'Save and continue'}).click();
  check('Invalid email shows an error beside the field',await input('Email').getAttribute('aria-invalid')==='true'&&await client.getByText('Enter a valid email address.',{exact:true}).isVisible());
  check('Invalid email does not advance to the agent section',await page.locator('details').filter({has:page.locator('summary').filter({hasText:'Agent and practice'})}).getAttribute('open')===null);
  await open('auto',[savedClient],{delay:1000});
  check('Project creation waits for saved-client selection',await page.getByRole('button',{name:'Create Project',exact:true}).isDisabled());
  await input('Email').fill('manually-entered@example.test');
  await waitFor(()=>client.getByRole('button',{name:'Save and continue'}).isEnabled(),'delayed lookup did not finish');
  check('A late lookup response does not overwrite a manual correction',await input('Email').inputValue()==='manually-entered@example.test'&&!patches.some(p=>p.clientMode==='existing'));
  await open('auto',[savedClient],{failedLookup:true});
  await client.getByText('Directory unavailable',{exact:false}).waitFor();
  check('Failed directory lookup leaves prepared data intact',await input('Email').inputValue()==='');
  failedLookup=false;await client.getByRole('button',{name:'Retry',exact:true}).click();
  await waitFor(()=>patches.some(p=>p.existingClientId===savedClient.id),'directory retry did not select matching client');
  check('Directory retry resolves the saved-client default',await input('Email').inputValue()===savedClient.email);
  await open('separate');
  await client.getByRole('radio',{name:'Yes, use the client'}).check();
  await waitFor(()=>patches.some(p=>!p.applicantDifferentFromClient),'relationship not saved');
  await client.getByRole('radio',{name:'No, a different applicant'}).check();
  check('Separate applicant survives saving the same-client relationship',await client.getByRole('textbox',{name:'applicant Applicant name',exact:true}).inputValue()==='James MacDonald');
  await client.getByRole('textbox',{name:'applicant First name',exact:true}).fill('Jamie');
  await client.getByRole('radio',{name:'Yes, use the client'}).check();
  await input('Email').fill('corrected@example.test');
  await waitFor(()=>patches.some(p=>p.client.email==='corrected@example.test'),'client correction not saved');
  await client.getByRole('radio',{name:'No, a different applicant'}).check();
  check('Client corrections do not erase separate applicant edits',await client.getByRole('textbox',{name:'applicant First name',exact:true}).inputValue()==='Jamie');
  await open('complete');
  failSave=true;await input('Email').fill('retry@example.test');
  await client.getByRole('button',{name:'Save and continue'}).click();
  await client.locator('.cr-save-error').waitFor();
  check('Failed save preserves entered values',await input('Email').inputValue()==='retry@example.test');
  failSave=false;await client.getByRole('button',{name:'Save and continue'}).click();
  await waitFor(()=>patches.some(p=>p.client.email==='retry@example.test'),'retry failed');
  check('Retry saves the retained values',true);
  for(const state of ['complete','missing','separate']){
    for(const width of [1440,390]){
      await page.setViewportSize({width,height:1000});await open(state);
      await waitFor(()=>client.getByRole('button',{name:'Save and continue'}).isEnabled(),'lookup not finished');
      await client.scrollIntoViewIfNeeded();
      await waitFor(()=>page.locator('.project-review-footer').evaluate(el=>getComputedStyle(el).position!=='sticky'),'project footer still overlaps client section');
      await client.screenshot({path:path.join(output,`implemented-${state}-${width}.png`)});
      check(`${state} at ${width}px has no horizontal overflow`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    }
  }
  await page.setViewportSize({width:320,height:844});await open('complete');
  await client.scrollIntoViewIfNeeded();
  check('Narrow mobile layout reflows at 320px',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await client.getByRole('button',{name:'Search existing clients'}).focus();await page.keyboard.press('Enter');
  await waitFor(()=>client.getByRole('searchbox').evaluate(el=>document.activeElement===el),'search did not receive keyboard focus');
  check('Keyboard search opens with focus in the query field',true);
  check('No browser runtime errors',errors.length===0);
  await fs.writeFile(path.join(output,'browser-results.json'),JSON.stringify({checks,errors},null,2));
  console.log(`${checks.length} browser checks passed; screenshots in ${output}`);
}finally{await browser.close();await new Promise(r=>server.close(r));}

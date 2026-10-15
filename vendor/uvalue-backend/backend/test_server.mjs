import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
import {createBackend} from './server.mjs';
import {UValueClient,UValueApiError} from './client.mjs';
import {ServiceError} from './pool.mjs';
const wall={element:'layered_wall',layers:[{thickness_mm:100,conductivity:.04}]};
async function running(options={}){
  const app=createBackend({requestsPerMinute:0,poolOptions:{size:1},...options});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${app.server.address().port}`;
  for(let i=0;i<200&&app.pool.stats().ready===0;i++)await delay(5);
  return {...app,base};
}
const post=(base,path,body,options={})=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...options.headers},body:typeof body==='string'?body:JSON.stringify(body),...options});

test('HTTP calculation, validation, discovery and examples use the documented envelopes',async t=>{
  const app=await running();t.after(()=>app.close());
  for(const path of ['/health','/ready','/v1/methods','/v1/schema','/v1/examples','/v1/examples/timber-wall']){
    const r=await fetch(app.base+path);assert.equal(r.status,200,path);const json=await r.json();assert.equal(json.api_version,'1');assert.ok(json.data);assert.equal(r.headers.get('x-request-id'),json.request_id);
  }
  const response=await post(app.base,'/v1/calculate',{construction:wall});const body=await response.json();assert.equal(response.status,200);assert.equal(body.data.u_value_2dp,.37);
  assert.equal((await (await post(app.base,'/v1/validate',{construction:wall})).json()).data.valid,true);
  const openapi=await (await fetch(app.base+'/v1/openapi.json')).json();assert.equal(openapi.openapi,'3.1.0');assert.ok(openapi.paths['/v1/solve-thickness']);
});
test('Schema and physics errors return 422 with actionable fields; invalid JSON returns 400',async t=>{
  const app=await running();t.after(()=>app.close());
  let r=await post(app.base,'/v1/calculate',{construction:{...wall,typo:1}});assert.equal(r.status,422);assert.ok((await r.json()).error.issues.some(i=>i.path==='/construction/typo'));
  r=await post(app.base,'/v1/calculate',{construction:{...wall,fractions:[.5]}});assert.equal(r.status,422);assert.equal((await r.json()).error.code,'CALCULATION_INPUT_ERROR');
  for(const body of ['{broken','{"construction":{"element":"layered_wall","metadata":{"__proto__":{}}}}']){
    r=await post(app.base,'/v1/calculate',body);assert.equal(r.status,body==='{broken'?400:422);
  }
});
test('HTTP method, media type, query, route and example errors are explicit',async t=>{
  const app=await running();t.after(()=>app.close());
  const wrongMethod=await fetch(app.base+'/v1/calculate');assert.equal(wrongMethod.status,405);assert.equal(wrongMethod.headers.get('allow'),'POST, OPTIONS');
  assert.equal((await fetch(app.base+'/missing')).status,404);
  assert.equal((await fetch(app.base+'/v1/examples/no-such-example')).status,404);
  assert.equal((await fetch(app.base+'/v1/examples/%ZZ')).status,400);
  assert.equal((await fetch(app.base+'/v1/methods?ignored=1')).status,400);
  assert.equal((await fetch(app.base+'/v1/calculate',{method:'POST',body:'{}'})).status,415);
  assert.equal((await post(app.base,'/v1/calculate',{}, {headers:{'Content-Type':'application/json','Content-Encoding':'gzip'}})).status,415);
});
test('Configured bearer key is checked and never returned in errors',async t=>{
  const key='test-service-key-at-least-24-chars';const app=await running({apiKey:key});t.after(()=>app.close());
  const r=await fetch(app.base+'/v1/methods');assert.equal(r.status,401);assert.equal(r.headers.get('www-authenticate'),'Bearer');assert.ok(!(await r.text()).includes(key));
  assert.equal((await fetch(app.base+'/v1/methods',{headers:{Authorization:'Bearer wrong'}})).status,401);
  assert.equal((await fetch(app.base+'/v1/methods',{headers:{Authorization:`Bearer ${key}`}})).status,200);
  assert.equal((await fetch(app.base+'/health')).status,200);
});
test('CORS allows exact configured origin, validates preflight and rejects unknown/null origins',async t=>{
  const origin='https://example.test',app=await running({corsOrigins:[origin]});t.after(()=>app.close());
  const r=await fetch(app.base+'/v1/methods',{headers:{Origin:origin}});assert.equal(r.headers.get('access-control-allow-origin'),origin);
  const preflight=await fetch(app.base+'/v1/calculate',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'Content-Type, Authorization'}});assert.equal(preflight.status,204);
  for(const origin of ['https://unknown.test','null'])assert.equal((await fetch(app.base+'/v1/methods',{headers:{Origin:origin}})).status,403);
  assert.equal((await fetch(app.base+'/v1/calculate',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'DELETE'}})).status,403);
});
test('Request size and per-client rate are enforced without harming health checks',async t=>{
  const app=await running({maxBodyBytes:128,requestsPerMinute:2});t.after(()=>app.close());
  assert.equal((await post(app.base,'/v1/calculate',{padding:'x'.repeat(500)})).status,413);
  assert.equal((await fetch(app.base+'/v1/methods')).status,200);
  const r=await fetch(app.base+'/v1/methods');assert.equal(r.status,429);assert.ok(Number(r.headers.get('retry-after'))>0);assert.equal((await fetch(app.base+'/health')).status,200);
});
test('Streamed bodies above the limit receive a structured 413',async t=>{
  const app=await running({maxBodyBytes:128});t.after(()=>app.close());
  const r=await new Promise((resolve,reject)=>{
    const req=http.request(app.base+'/v1/calculate',{method:'POST',headers:{'Content-Type':'application/json','Transfer-Encoding':'chunked'}},res=>{let body='';res.on('data',b=>body+=b);res.on('end',()=>resolve({status:res.statusCode,body}));});
    req.on('error',reject);req.write('{"padding":"');req.write('x'.repeat(300));req.end('"}');
  });assert.equal(r.status,413);assert.equal(JSON.parse(r.body).error.code,'REQUEST_TOO_LARGE');
});
test('Client integrates calculation, batch, project and thickness endpoints and preserves API errors',async t=>{
  const app=await running();t.after(()=>app.close());const client=new UValueClient({baseUrl:app.base});
  assert.equal((await client.calculate(wall)).u_value_2dp,.37);assert.equal((await client.validate(wall)).valid,true);assert.equal((await client.examples()).length,16);
  assert.equal((await client.batch([{id:'a',construction:wall}])).succeeded,1);
  const project=await client.project({elements:[{id:'wall',gross_area_m2:10,construction:wall}],junctions:[]});assert.ok(project.transmission_heat_loss_coefficient_w_k>0);
  const thickness=await client.solveThickness({construction:wall,layer_index:0,target_u_value_w_m2k:.2,minimum_thickness_mm:10,maximum_thickness_mm:300,increment_mm:5});assert.equal(thickness.thickness_mm,195);
  const network=await client.unheatedNetwork({nodes:[{id:'garage',external_heat_loss_coefficient_w_k:10}],
    inside_elements:[{id:'wall',node_id:'garage',area_m2:10,construction:{...wall,rse:.13}}],links:[],
    no_heat_gains:true,all_external_paths_to_same_temperature:true,component_boundaries_consistent:true});assert.ok(network.effective_heat_loss_coefficient_w_k>0);
  await assert.rejects(client.calculate({...wall,typo:true}),e=>e instanceof UValueApiError&&e.status===422&&e.issues.length>0);
});
test('Client cancellation and non-JSON upstream errors do not leak an unstructured exception',async()=>{
  const client=new UValueClient({fetch:async()=>({ok:false,status:502,json:async()=>{throw Error('HTML')}})});
  await assert.rejects(client.methods(),e=>e.code==='INVALID_RESPONSE'&&e.status===502);
  const cancelled=new UValueClient({timeoutMs:10,fetch:async(_url,{signal})=>new Promise((_resolve,reject)=>{signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true});})});
  await assert.rejects(cancelled.methods(),e=>e.code==='REQUEST_ABORTED');
});
test('Invalid service configuration fails before starting workers',()=>{
  assert.throws(()=>createBackend({apiKey:'short'}),/24/);assert.throws(()=>createBackend({corsOrigins:['*']}));assert.throws(()=>createBackend({maxBodyBytes:0}),/maxBodyBytes/);
});
test('Oversized output receives a structured result-limit error',async t=>{
  const app=await running({maxResponseBytes:1024});t.after(()=>app.close());
  const r=await fetch(app.base+'/v1/methods');assert.equal(r.status,422);assert.equal((await r.json()).error.code,'RESULT_TOO_LARGE');
});
test('Client disconnect cancels its calculation while health remains responsive',async t=>{
  let started,aborted;const began=new Promise(r=>started=r),ended=new Promise(r=>aborted=r);
  const pool={stats:()=>({workers:1,ready:1,running:1,queued:0}),close:async()=>{},submit:(_op,_body,{signal})=>{
    started();return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{aborted();reject(new ServiceError('REQUEST_CANCELLED','Cancelled',499));},{once:true}));
  }};
  const app=await running({pool});t.after(()=>app.close());
  const req=http.request(app.base+'/v1/calculate',{method:'POST',headers:{'Content-Type':'application/json'}});req.on('error',()=>{});req.end(JSON.stringify({construction:wall}));
  await began;assert.equal((await fetch(app.base+'/health')).status,200);req.destroy();
  await Promise.race([ended,delay(2000).then(()=>{throw Error('Cancellation was not propagated');})]);
});

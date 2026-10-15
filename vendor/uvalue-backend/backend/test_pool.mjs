import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {CalculationPool} from './pool.mjs';
const testWorker=`import {parentPort} from 'node:worker_threads';
parentPort.on('message',m=>{if(m.operation==='exit'){process.exit(2);return;}if(m.operation==='slow'){const until=Date.now()+5000;while(Date.now()<until){}}parentPort.postMessage({id:m.id,ok:true,data:m.payload});});parentPort.postMessage({ready:true});`;
async function setup(t,options={}){
  const tempRoot=resolve(tmpdir()),directory=await mkdtemp(join(tempRoot,'uvalue-test-worker-'));const file=join(directory,'fixture.mjs');await writeFile(file,testWorker);
  const pool=new CalculationPool({size:1,timeoutMs:100,workerUrl:pathToFileURL(file),...options});
  t.after(async()=>{await pool.close();const target=resolve(directory);
    if(dirname(target)!==tempRoot||!basename(target).startsWith('uvalue-test-worker-'))throw Error('Refusing to remove an unexpected temporary path');
    await rm(target,{recursive:true,force:true});});
  for(let i=0;i<200&&!pool.stats().ready;i++)await delay(5);
  return pool;
}
async function ready(pool){for(let i=0;i<200&&!pool.stats().ready;i++)await delay(5);assert.equal(pool.stats().ready,1);}

test('Pool bounds waiting work, times out blocked computation and replaces that worker',async t=>{
  const pool=await setup(t,{maxQueue:1});
  const slow=assert.rejects(pool.submit('slow',{}),e=>e.code==='CALCULATION_TIMEOUT');
  const queued=pool.submit('echo',{saved:true}).then(data=>data,error=>error);
  await assert.rejects(pool.submit('echo',{}),e=>e.code==='SERVICE_BUSY');
  await slow;const q=await queued;assert.ok(q.saved===true||q.code==='QUEUE_TIMEOUT');await ready(pool);
  assert.deepEqual(await pool.submit('echo',{working:true}),{working:true});
});
test('Cancelling queued work removes it; cancelling running work replaces its worker',async t=>{
  const pool=await setup(t,{timeoutMs:500});
  const running=new AbortController(),waiting=new AbortController();
  const first=assert.rejects(pool.submit('slow',{}, {signal:running.signal}),e=>e.code==='REQUEST_CANCELLED');
  const second=assert.rejects(pool.submit('echo',{}, {signal:waiting.signal}),e=>e.code==='REQUEST_CANCELLED');
  waiting.abort();await second;assert.equal(pool.stats().queued,0);running.abort();await first;
  await ready(pool);assert.equal(await pool.submit('echo',123),123);
});
test('Unexpected worker exit rejects only its job and restores service capacity',async t=>{
  const pool=await setup(t);await assert.rejects(pool.submit('exit',{}),e=>e.code==='WORKER_FAILED');await ready(pool);assert.equal(await pool.submit('echo',4),4);
});
test('Graceful shutdown rejects running/queued work and future submissions',async t=>{
  const pool=await setup(t,{timeoutMs:500});
  const first=assert.rejects(pool.submit('slow',{}),e=>e.code==='SERVICE_CLOSED');
  const queued=assert.rejects(pool.submit('echo',{}),e=>e.code==='SERVICE_CLOSED');
  await pool.close();await first;await queued;await assert.rejects(pool.submit('echo',{}),e=>e.code==='SERVICE_CLOSED');
});

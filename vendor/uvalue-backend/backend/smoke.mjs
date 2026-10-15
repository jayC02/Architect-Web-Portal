import {setTimeout as delay} from 'node:timers/promises';
import {createBackend} from './server.mjs';
import {UValueClient} from './client.mjs';
const app=createBackend({requestsPerMinute:0,poolOptions:{size:1}});
try{
  await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(0,'127.0.0.1',resolve);});
  const api=new UValueClient({baseUrl:`http://127.0.0.1:${app.server.address().port}`});
  for(let i=0;i<200&&!app.pool.stats().ready;i++)await delay(5);
  const ids=await api.examples();let checked=0;
  for(const {id}of ids){const e=await api.example(id),r=await api.calculate(e.input);if(!Number.isFinite(r.u_value)||r.u_value<0)throw Error(`Invalid result for ${id}`);checked++;}
  console.log(`Backend smoke check passed: ${checked} HTTP example calculations; no external service required.`);
}finally{await app.close();}

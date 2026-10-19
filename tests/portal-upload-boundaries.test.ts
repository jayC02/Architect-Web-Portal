import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {applicationFileSha256,runUploadQueue} from '../src/lib/application-upload-queue';
import {documentContentDisposition} from '../src/lib/server/content-disposition';

test('same-length PDFs have distinct content identities',async()=>{
 const a=new Blob(['%PDF-first']);const b=new Blob(['%PDF-other']);
 assert.equal(a.size,b.size);
 assert.equal(await applicationFileSha256(a),createHash('sha256').update('%PDF-first').digest('hex'));
 assert.notEqual(await applicationFileSha256(a),await applicationFileSha256(b));
});

test('an upload failure drains running workers and processes the rest before returning control',async()=>{
 let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
 const completed:number[]=[];let settled=false;
 const queue=runUploadQueue([0,1,2],2,async item=>{
  if(item===0)throw new Error('Upload failed');
  if(item===1)await held;
  completed.push(item);
 }).then(()=>{settled=true;},error=>{settled=true;throw error;});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(settled,false);assert.deepEqual(completed,[2]);
 release();await assert.rejects(queue,/Upload failed/);assert.deepEqual(completed,[2,1]);
});

for(const filename of ['Plan – café 🏠.pdf','中庭.pdf',`Drawing "one"\r\nX-Injected: bad.pdf`,'Bad\ud800.pdf']) {
 test(`download header handles ${JSON.stringify(filename)}`,()=>{
  const value=documentContentDisposition('attachment',filename);
  const response=new Response('pdf',{headers:{'content-disposition':value}});
  assert.equal(response.status,200);assert.doesNotMatch(value,/[\r\n]|[^\x20-\x7e]/);
  const decoded=decodeURIComponent(value.split("filename*=UTF-8''")[1]);
  assert.equal(decoded,new TextDecoder().decode(new TextEncoder().encode(filename)).replace(/[\u0000-\u001f\u007f"\\]/g,'_'));
 });
}

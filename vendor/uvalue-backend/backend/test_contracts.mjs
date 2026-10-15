import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {SCHEMA,schemaIssues} from './schema.mjs';
import {openapiDocument} from './openapi.mjs';
test('Published JSON and OpenAPI contracts match their generating source',async()=>{
  assert.deepEqual(JSON.parse(await readFile(new URL('./schema.json',import.meta.url),'utf8')),SCHEMA);
  assert.deepEqual(JSON.parse(await readFile(new URL('./openapi.json',import.meta.url),'utf8')),openapiDocument());
});
test('All OpenAPI references resolve inside the delivered document',()=>{
  const document=openapiDocument();let references=0;
  function walk(value){
    if(!value||typeof value!=='object')return;
    if(value.$ref){assert.ok(value.$ref.startsWith('#/'));let target=document;for(const key of value.$ref.slice(2).split('/'))target=target?.[key.replaceAll('~1','/').replaceAll('~0','~')];assert.ok(target,value.$ref);references++;}
    for(const x of Object.values(value))walk(x);
  }
  walk(document);assert.ok(references>20);
});
test('The shipped connected-space request meets its published schema',async()=>{
  const network=JSON.parse(await readFile(new URL('./example-unheated-network.json',import.meta.url),'utf8'));
  assert.deepEqual(schemaIssues(network,'NetworkRequest'),[]);
});

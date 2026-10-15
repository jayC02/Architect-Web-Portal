import {writeFile,copyFile} from 'node:fs/promises';
import {SCHEMA} from './schema.mjs';
import {openapiDocument} from './openapi.mjs';
const js=x=>JSON.stringify(x);
function ts(s){
  if(s.$ref)return s.$ref.split('/').at(-1);
  if(s.const!==undefined)return js(s.const);
  if(s.enum)return s.enum.map(js).join(' | ');
  if(s.oneOf)return s.oneOf.map(ts).map(x=>`(${x})`).join(' | ');
  if(s.type==='number'||s.type==='integer')return 'number';
  if(s.type==='boolean')return 'boolean';if(s.type==='string')return 'string';
  if(s.type==='array')return `Array<${ts(s.items)}>`;
  if(s.type==='object')return s.properties?`{ ${Object.entries(s.properties).map(([key,v])=>`${js(key)}${s.required?.includes(key)?'':'?'}: ${ts(v)};`).join(' ')} }`:'Record<string, unknown>';
  return 'unknown';
}
export async function generateContracts(){
  const types='// Generated from schema.mjs; do not edit. Numeric constraints remain runtime checks.\n'+
    Object.entries(SCHEMA.$defs).map(([name,s])=>`export type ${name} = ${ts(s)};`).join('\n')+'\n';
  await writeFile(new URL('./contracts.d.ts',import.meta.url),types);
  await writeFile(new URL('./schema.json',import.meta.url),JSON.stringify(SCHEMA,null,2)+'\n');
  await writeFile(new URL('./openapi.json',import.meta.url),JSON.stringify(openapiDocument(),null,2)+'\n');
  await copyFile(new URL('./client.d.ts',import.meta.url),new URL('./client.d.mts',import.meta.url));
}
await generateContracts();

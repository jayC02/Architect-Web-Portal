import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import config from '../tailwind.config.mjs';
const js = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import Queue from './src/components/automation/AgentQueueDropdown';createRoot(document.getElementById('root')).render(<main className="p-4"><div className="flex justify-end"><Queue/></div><h1>Projects</h1></main>);`, resolveDir: process.cwd(), loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"test"'}});
const css=await postcss([tailwindcss(config)]).process(readFileSync('src/styles/global.css','utf8'),{from:'src/styles/global.css'});
const jobs=[{id:'planning-a',title:'Rear extension',type:'HOUSEHOLDER_PLANNING',status:'IN_PROGRESS',progressPercent:42,progressMessage:'Uploading documents',project:{id:'a',name:'Oak House'}},{id:'warrant-a',title:'Rear extension warrant',type:'BUILDING_WARRANT',status:'READY',progressPercent:null,project:{id:'a',name:'Oak House'}},{id:'planning-b',title:'Garage conversion',type:'HOUSEHOLDER_PLANNING',status:'READY',progressPercent:null,project:{id:'b',name:'Hill Cottage'}}];
createServer((req,res)=>{
 if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(js.outputFiles[0].text);return;}
 if(req.url==='/style.css'){res.setHeader('Content-Type','text/css');res.end(css.css);return;}
 if(req.url==='/api/automation-jobs/queue'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({active:jobs,recent:[]}));return;}
 res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
}).listen(4329,'127.0.0.1',()=>console.log('Queue fixture ready at http://127.0.0.1:4329'));

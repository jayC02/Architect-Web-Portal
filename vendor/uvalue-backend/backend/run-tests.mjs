import {readdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url),backend=new URL('./',import.meta.url);
const files=[];
for(const base of [root,backend])for(const name of await readdir(base))if(/^test_.*\.mjs$/.test(name)){
  // The backend-only archive omits the offline browser compiler/UI.
  if(name==='test_browser_bundle.mjs'&&!(await readdir(root)).includes('build-browser.mjs'))continue;
  files.push(fileURLToPath(new URL(name,base)));
}
const child=spawn(process.execPath,['--test','--test-reporter=spec',...files],{stdio:'inherit'});
child.on('exit',code=>{process.exitCode=code??1;});child.on('error',error=>{console.error(error.message);process.exitCode=1;});

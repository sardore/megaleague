import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';

const relay=process.env.MEGA_RELAY_SOURCE;
if(!relay)throw new Error('Set MEGA_RELAY_SOURCE to a checkout of sardore/cp32-online-relay/server.js');
const children=[];
function start(file,args=[],env={}){
  const child=spawn(process.execPath,[file,...args],{stdio:'inherit',env:{...process.env,...env}});
  children.push(child);return child;
}
async function ready(url){
  const deadline=Date.now()+15000;
  while(Date.now()<deadline){try{const r=await fetch(url);if(r.ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}
  throw new Error(`Server did not start: ${url}`);
}
try{
  start('tools/serve.js');
  start(path.resolve(relay),[],{CP32_RELAY_HOST:'127.0.0.1',CP32_RELAY_PORT:'8787'});
  await Promise.all([ready('http://127.0.0.1:4173'),ready('http://127.0.0.1:8787/health')]);
  const files=process.argv.slice(2);
  if(!files.length)files.push(...(await fs.readdir('tests/e2e')).filter(f=>f.startsWith('current-real-relay')&&f.endsWith('.spec.js')).map(f=>'tests/e2e/'+f));
  const test=start('node_modules/@playwright/test/cli.js',['test',...files,'--workers=1']);
  process.exitCode=await new Promise((resolve,reject)=>{test.on('exit',code=>resolve(code??1));test.on('error',reject);});
}finally{for(const child of children)child.kill('SIGTERM');}

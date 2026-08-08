import dns from 'node:dns/promises';
import fs from 'node:fs';
import { RELAY_ENDPOINT, PRODUCTION_URL, CANDIDATE_ORIGIN, EXPECTED_SHA256, EXPECTED_SIZE } from './constants.js';
import { requestLocalCandidateJson } from './local-candidate-tls.js';

async function websocketOpen(url, timeout=15000) {
  return await new Promise((resolve,reject)=>{
    const ws=new WebSocket(url);
    const timer=setTimeout(()=>{try{ws.close()}catch{};reject(new Error('RELAY_WEBSOCKET_FAILED:timeout'));},timeout);
    ws.addEventListener('open',()=>{clearTimeout(timer);ws.close();resolve(true)},{once:true});
    ws.addEventListener('error',()=>{clearTimeout(timer);reject(new Error('RELAY_WEBSOCKET_FAILED:error'))},{once:true});
  });
}

export async function runPreflight({mode=process.env.CP32_PREFLIGHT_MODE || process.env.CP32_TARGET_MODE || 'candidate'}={}) {
  if (!['candidate','production'].includes(mode)) throw new Error(`PREFLIGHT_MODE_INVALID:${mode}`);
  const out={mode,startedAt:new Date().toISOString(),checks:[]};
  async function check(name,fn){
    try{const value=await fn();out.checks.push({name,ok:true,value});return value;}
    catch(error){out.checks.push({name,ok:false,error:String(error),code:error?.code||null});return undefined;}
  }
  if(mode==='production') await check('GITHUB_PAGES_DNS',()=>dns.lookup('sardore.github.io',{all:true}));
  else out.checks.push({name:'GITHUB_PAGES_DNS',ok:true,skipped:true,reason:'NOT_CANDIDATE_RESPONSIBILITY'});

  await check('RELAY_DNS',()=>dns.lookup('cp32-online-relay.onrender.com',{all:true}));

  if(mode==='production') {
    await check('PRODUCTION_HTTPS',async()=>{
      const r=await fetch(PRODUCTION_URL,{redirect:'follow'});
      const size=(await r.arrayBuffer()).byteLength;
      if(!r.ok) throw new Error(`PRODUCTION_HTTPS_STATUS:${r.status}`);
      return {status:r.status,size};
    });
    out.checks.push({name:'CANDIDATE_HTTPS',ok:true,skipped:true,reason:'NOT_PRODUCTION_RESPONSIBILITY'});
  } else {
    out.checks.push({name:'PRODUCTION_HTTPS',ok:true,skipped:true,reason:'NOT_CANDIDATE_RESPONSIBILITY'});
    await check('CANDIDATE_HTTPS',async()=>{
      const health=await requestLocalCandidateJson(`${CANDIDATE_ORIGIN}/healthz`);
      if(health?.sha!==EXPECTED_SHA256 || health?.size!==EXPECTED_SIZE) throw new Error(`CANDIDATE_IDENTITY_MISMATCH:${health?.sha}:${health?.size}`);
      return health;
    });
  }

  await check('RELAY_WEBSOCKET',()=>websocketOpen(RELAY_ENDPOINT));
  out.completedAt=new Date().toISOString();
  out.ok=out.checks.filter(x=>!x.skipped).every(x=>x.ok);
  if(!out.ok){
    const failed=out.checks.filter(x=>!x.ok).map(x=>x.name);
    const error=new Error(`PREFLIGHT_FAILED:${failed.join(',')}`);
    error.preflight=out;
    throw error;
  }
  return out;
}

if(import.meta.url===`file://${process.argv[1]}`){
  const outFile=process.env.CP32_PREFLIGHT_OUTPUT||'artifacts/preflight/preflight.json';
  fs.mkdirSync('artifacts/preflight',{recursive:true});
  try{
    const result=await runPreflight();
    fs.writeFileSync(outFile,JSON.stringify(result,null,2)+'\n');
    console.log(JSON.stringify(result));
  } catch(error) {
    const record=error?.preflight || {ok:false,error:String(error),at:new Date().toISOString()};
    fs.writeFileSync(outFile,JSON.stringify(record,null,2)+'\n');
    console.error(error);
    process.exit(2);
  }
}

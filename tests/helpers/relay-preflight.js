import dns from 'node:dns/promises';
import fs from 'node:fs';
import { RELAY_ENDPOINT, PRODUCTION_URL, CANDIDATE_ORIGIN } from './constants.js';
async function websocketOpen(url, timeout=15000) {
  return await new Promise((resolve,reject)=>{
    const ws=new WebSocket(url); const timer=setTimeout(()=>{try{ws.close()}catch{};reject(new Error('RELAY_WEBSOCKET_FAILED:timeout'));},timeout);
    ws.addEventListener('open',()=>{clearTimeout(timer);ws.close();resolve(true)},{once:true});
    ws.addEventListener('error',()=>{clearTimeout(timer);reject(new Error('RELAY_WEBSOCKET_FAILED:error'))},{once:true});
  });
}
export async function runPreflight({candidate=true,production=true}={}) {
  const out={startedAt:new Date().toISOString(),checks:[]};
  async function check(name,fn){try{const value=await fn();out.checks.push({name,ok:true,value});return value}catch(e){out.checks.push({name,ok:false,error:String(e)});throw e}}
  await check('GITHUB_PAGES_DNS',()=>dns.lookup('sardore.github.io',{all:true}));
  await check('RELAY_DNS',()=>dns.lookup('cp32-online-relay.onrender.com',{all:true}));
  if(production)await check('PRODUCTION_HTTPS',async()=>{const r=await fetch(PRODUCTION_URL,{redirect:'follow'});return {status:r.status,size:(await r.arrayBuffer()).byteLength}});
  if(candidate)await check('CANDIDATE_HTTPS',async()=>{const r=await fetch(`${CANDIDATE_ORIGIN}/healthz`);return await r.json()});
  await check('RELAY_WEBSOCKET',()=>websocketOpen(RELAY_ENDPOINT));
  out.completedAt=new Date().toISOString();return out;
}
if(import.meta.url===`file://${process.argv[1]}`){
  const outFile=process.env.CP32_PREFLIGHT_OUTPUT||'artifacts/preflight/preflight.json';
  try{const result=await runPreflight();fs.mkdirSync('artifacts/preflight',{recursive:true});fs.writeFileSync(outFile,JSON.stringify(result,null,2));console.log(JSON.stringify(result));}
  catch(error){fs.mkdirSync('artifacts/preflight',{recursive:true});fs.writeFileSync(outFile,JSON.stringify({ok:false,error:String(error),at:new Date().toISOString()},null,2));console.error(error);process.exit(2)}
}

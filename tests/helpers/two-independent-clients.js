import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {localCandidateChromiumArgs} from './local-candidate-tls.js';

async function launchOne(name,artifactRoot){
  const userDataDir=fs.mkdtempSync(path.join(os.tmpdir(),`cp32-${name}-`));
  const executable=chromium.executablePath();
  const targetMode=process.env.CP32_TARGET_MODE || 'candidate';
  const tlsArgs=targetMode==='candidate' ? localCandidateChromiumArgs() : [];
  const args=['--headless=new','--no-sandbox','--disable-dev-shm-usage',...tlsArgs,`--user-data-dir=${userDataDir}`,'--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--window-size=412,915','about:blank'];
  const proc=spawn(executable,args,{stdio:['ignore','pipe','pipe']});let stderr='';proc.stderr.setEncoding('utf8');proc.stderr.on('data',d=>stderr+=d);
  const endpoint=await new Promise((resolve,reject)=>{const deadline=setTimeout(()=>reject(new Error(`CHROMIUM_ENDPOINT_TIMEOUT:${stderr}`)),20000);proc.stderr.on('data',()=>{const m=stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(deadline);resolve(m[1])}});proc.once('exit',c=>{clearTimeout(deadline);reject(new Error(`CHROMIUM_EXITED:${c}:${stderr}`))});});
  const browser=await chromium.connectOverCDP(endpoint);const context=browser.contexts()[0];const pages=context.pages();const page=pages[0]||await context.newPage();
  const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setDeviceMetricsOverride',{width:412,height:915,deviceScaleFactor:2.625,mobile:true,screenWidth:412,screenHeight:915});await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});await cdp.send('Emulation.setUserAgentOverride',{userAgent:'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36'});
  fs.mkdirSync(artifactRoot,{recursive:true});fs.writeFileSync(path.join(artifactRoot,'process.json'),JSON.stringify({name,pid:proc.pid,userDataDir,endpoint,args,targetMode,tlsPolicy:targetMode==='candidate'?'LOCAL_CERT_SPKI_ONLY':'PLATFORM_DEFAULT_STRICT',startedAt:new Date().toISOString()},null,2));
  return {name,pid:proc.pid,userDataDir,proc,browser,context,page,async close(){try{await browser.close()}catch{};if(!proc.killed)proc.kill('SIGTERM')}};
}
export async function launchTwoIndependentClients(artifactBase){
  const host=await launchOne('host',path.join(artifactBase,'host'));const guest=await launchOne('guest',path.join(artifactBase,'guest'));
  if(host.pid===guest.pid||host.userDataDir===guest.userDataDir)throw new Error('CLIENT_ISOLATION_FAILED');return {host,guest,async close(){await Promise.allSettled([host.close(),guest.close()])}};
}

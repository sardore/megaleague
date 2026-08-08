import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {ANDROID_PACKAGE,ANDROID_ACTIVITY,ADB,CASES} from './android-driver-config.js';
import {launchAndroidPeer} from './android-peer-client.js';
import {candidateUrl} from '../helpers/constants.js';
import {createRoomHost,waitForLobby,selectFour,waitRemoteCount,touchFirstLegalAction,runtimeSummary} from '../helpers/player-path.js';
import {requireLocalCandidateSpki} from '../helpers/local-candidate-tls.js';

const out='artifacts/android';fs.mkdirSync(out,{recursive:true});
const run=(...a)=>execFileSync(ADB,a,{encoding:'utf8'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function record(name,data){fs.writeFileSync(path.join(out,name),typeof data==='string'?data:JSON.stringify(data,null,2));}
async function cdpConnect(){
  run('forward','tcp:9222','localabstract:chrome_devtools_remote');
  for(let tries=0;tries<30;tries++){
    try{const tabs=await (await fetch('http://127.0.0.1:9222/json')).json();const tab=tabs.find(x=>x.type==='page');if(tab){const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej});let id=0;const pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id)}};const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,m=>m.error?reject(new Error(JSON.stringify(m.error))):resolve(m.result));ws.send(JSON.stringify({id:n,method,params}))});return {ws,send};}}catch{}await sleep(500);
  }
  throw new Error('ANDROID_CHROME_CDP_UNAVAILABLE');
}
async function evaluate(cdp,expression){const r=await cdp.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(`ANDROID_EVALUATION_FAILED:${r.exceptionDetails.text}`);return r.result.value;}
async function bounds(cdp,selector){return evaluate(cdp,`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {x:r.x,y:r.y,w:r.width,h:r.height,visible:!!(r.width&&r.height&&s.visibility!=='hidden'&&s.display!=='none'),disabled:!!e.disabled,text:e.textContent||''}})()`);}
async function tap(cdp,selector){const b=await bounds(cdp,selector);if(!b?.visible||b.disabled)throw new Error(`ANDROID_TARGET_UNAVAILABLE:${selector}:${JSON.stringify(b)}`);run('shell','input','tap',String(Math.round(b.x+b.w/2)),String(Math.round(b.y+b.h/2)));await sleep(300);return b;}
async function waitSelector(cdp,selector,timeout=60000){const end=Date.now()+timeout;while(Date.now()<end){const b=await bounds(cdp,selector).catch(()=>null);if(b?.visible)return b;await sleep(500);}throw new Error(`ANDROID_SELECTOR_TIMEOUT:${selector}`);}
async function androidSelectFour(cdp){for(let i=0;i<4;i++){await tap(cdp,'#onlineRoomDeck .online-room-card:not(.selected)');const end=Date.now()+10000;while(Date.now()<end){const n=await evaluate(cdp,"document.querySelectorAll('#onlineRoomDeck .online-room-card.selected').length");if(n===i+1)break;await sleep(250);}}}
async function androidSummary(cdp){return evaluate(cdp,`(()=>({build:document.querySelector('#cp32BuildIdentity')?.dataset.buildId||null,room:document.querySelector('#roomReadyState')?.textContent||null,lobby:!!document.querySelector('#onlineRoomDeck'),battle:!!document.querySelector('#actions'),actions:document.querySelectorAll('#actionButtons button:not([disabled])').length,runtime:window.OnlineRuntime?.debug?.()||null,diag:window.DiagnosticTraceOwner?.currentStateSummary?.()||null}))()`);}
async function androidResolveInteraction(cdp){for(let i=0;i<8;i++){const selector=await evaluate(cdp,`(()=>{const modal=document.querySelector('#modal.open');if(!modal)return null;return [...modal.querySelectorAll('button:not([disabled])')].find(b=>{const s=getComputedStyle(b),r=b.getBoundingClientRect(),t=(b.textContent||'').trim();return r.width&&r.height&&s.display!=='none'&&!/취소|뒤로|연결 끊기|메뉴/.test(t)})?.id||null})()`);if(!selector)return;await tap(cdp,`#${selector}`);}}
async function androidAction(cdp){await waitSelector(cdp,'#actionButtons button:not([disabled])',45000);await tap(cdp,'#actionButtons button:not([disabled])');await androidResolveInteraction(cdp);}
async function ensureAndroidTurn(cdp,peerPage){for(let i=0;i<20;i++){const a=await androidSummary(cdp);if(a.actions>0)return a;const p=await runtimeSummary(peerPage);if(p.actions>0)await touchFirstLegalAction(peerPage);await sleep(500);}throw new Error('ANDROID_LOCAL_TURN_NOT_REACHED');}
async function prepareChrome(url){
  try{run('shell','pm','clear',ANDROID_PACKAGE)}catch{}
  const spki=requireLocalCandidateSpki();
  const commandLine=`chrome --ignore-certificate-errors-spki-list=${spki} --disable-fre --no-default-browser-check`;
  run('shell','sh','-c',`printf '%s\n' ${JSON.stringify(commandLine)} > /data/local/tmp/chrome-command-line`);
  run('shell','am','start','-a','android.intent.action.VIEW','-d',url,ANDROID_PACKAGE);await sleep(7000);
}
async function main(){
  const androidUrl=process.env.CP32_ANDROID_CANDIDATE_URL||'https://10.0.2.2:8443/?relay=wss%3A%2F%2Fcp32-online-relay.onrender.com%2Fonline';
  const peerUrl=process.env.CP32_PEER_CANDIDATE_URL||candidateUrl();
  const peer=await launchAndroidPeer('artifacts/android-peer');
  try{
    await prepareChrome(androidUrl);const cdp=await cdpConnect();
    const identity=await androidSummary(cdp);if(identity.build!=='CP32-ACTIVE-WRAPPER-CUTOVER-R1-20260805T2220KST')throw new Error(`ANDROID_BUILD_IDENTITY_MISMATCH:${identity.build}`);
    const roomCode=await createRoomHost(peer.client.page);
    await tap(cdp,'#onlineBtn');await tap(cdp,'#openRoomCode');await tap(cdp,'#p2pGuest');await tap(cdp,'#roomCodeInput');run('shell','input','text',roomCode);await tap(cdp,'#joinRoom');
    await Promise.all([waitForLobby(peer.client.page),waitSelector(cdp,'#onlineRoomDeck')]);
    record('room-pair.json',{ok:true,roomCode});
    await androidSelectFour(cdp);await waitRemoteCount(peer.client.page,4);await selectFour(peer.client.page);
    const end=Date.now()+30000;while(Date.now()<end){if((await androidSummary(cdp)).room?.includes('상대 덱 4/4'))break;await sleep(500);}
    const start=await bounds(cdp,'#onlineRoomStart');if(start?.visible&&!start.disabled)await tap(cdp,'#onlineRoomStart');else{const b=await peer.client.page.locator('#onlineRoomStart').boundingBox();if(!b)throw new Error('NO_HOST_START_BUTTON');await peer.client.page.touchscreen.tap(b.x+b.width/2,b.y+b.height/2);}
    await Promise.all([waitSelector(cdp,'#actions',60000),peer.client.page.locator('#actions').waitFor({state:'visible',timeout:60000})]);
    await ensureAndroidTurn(cdp,peer.client.page);await androidAction(cdp);record('first-action.json',{ok:true,android:await androidSummary(cdp),peer:await runtimeSummary(peer.client.page)});
    const cases=[...Array(CASES.short)].map((_,i)=>({kind:'short',i,seconds:5,offline:false})).concat([...Array(CASES.long)].map((_,i)=>({kind:'long',i,seconds:30,offline:false})),[...Array(CASES.offline)].map((_,i)=>({kind:'offline',i,seconds:10,offline:true})));
    for(const c of cases){await ensureAndroidTurn(cdp,peer.client.page);try{run('shell','screenrecord','--time-limit',String(Math.min(180,c.seconds+15)),`/sdcard/cp32-${c.kind}-${c.i}.mp4`)}catch{};run('shell','input','keyevent','KEYCODE_HOME');if(c.offline)run('shell','svc','wifi','disable');await sleep(c.seconds*1000);if(c.offline)run('shell','svc','wifi','enable');run('shell','am','start','-n',`${ANDROID_PACKAGE}/${ANDROID_ACTIVITY}`);await sleep(5000);await ensureAndroidTurn(cdp,peer.client.page);await androidAction(cdp);const row={ok:true,case:c,android:await androidSummary(cdp),peer:await runtimeSummary(peer.client.page)};record(`${c.kind}-${c.i}.json`,row);try{run('pull',`/sdcard/cp32-${c.kind}-${c.i}.mp4`,path.join(out,`${c.kind}-${c.i}.mp4`))}catch{};try{fs.writeFileSync(path.join(out,`${c.kind}-${c.i}.png`),execFileSync(ADB,['exec-out','screencap','-p']))}catch{}
    }
    record('android-result.json',{ok:true,completedAt:new Date().toISOString(),caseCount:cases.length});cdp.ws.close();
  }finally{await peer.close();}
}
main().catch(e=>{record('android-result.json',{ok:false,error:String(e),at:new Date().toISOString()});try{record('logcat.txt',run('logcat','-d'))}catch{};process.exit(2)});

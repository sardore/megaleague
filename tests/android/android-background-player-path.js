import fs from 'node:fs';
import path from 'node:path';
import {execFile,execFileSync,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {
  ADB,ANDROID_ACTIVITY,ANDROID_PACKAGE,BATTLE_DECK,CHAOS_CYCLES,CHAOS_SEED,
  PRIMARY_CDP_PORT,PRIMARY_SERIAL,SECONDARY_CDP_PORT,SECONDARY_SERIAL,
} from './android-driver-config.js';
import {requireLocalCandidateSpki} from '../helpers/local-candidate-tls.js';

const execFileAsync=promisify(execFile);
const OUTPUT='artifacts/android';
const PREFLIGHT='artifacts/preflight';
const APP_URL=process.env.CP32_ANDROID_CANDIDATE_URL||'https://10.0.2.2:8443/?relay=wss%3A%2F%2Fcp32-online-relay.onrender.com%2Fonline';
const BUILD_ID='CP32-ACTIVE-WRAPPER-CUTOVER-R1-20260805T2220KST';
const SECONDARY_AVD='cp32-secondary';
const CLIENTS=Object.freeze([
  Object.freeze({name:'host',role:'host',serial:PRIMARY_SERIAL,cdpPort:PRIMARY_CDP_PORT,canonicalTeam:'P'}),
  Object.freeze({name:'guest',role:'guest',serial:SECONDARY_SERIAL,cdpPort:SECONDARY_CDP_PORT,canonicalTeam:'A'}),
]);
const active={stage:'bootstrap',cycle:null,spec:null,clients:new Map(),timeline:[],secondary:null,secondaryLogFd:null,videos:new Map()};

fs.mkdirSync(OUTPUT,{recursive:true});
fs.mkdirSync(PREFLIGHT,{recursive:true});

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const now=()=>Date.now();
const iso=()=>new Date().toISOString();
function record(name,value){fs.writeFileSync(path.join(OUTPUT,name),typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value,null,2));}
function runHost(file,args=[],options={}){return execFileSync(file,args,{encoding:'utf8',timeout:120000,...options});}
async function runHostAsync(file,args=[],options={}){return execFileAsync(file,args,{encoding:'utf8',timeout:120000,...options});}
function adb(client,...args){return runHost(ADB,['-s',client.serial,...args]);}
async function adbAsync(client,...args){return runHostAsync(ADB,['-s',client.serial,...args]);}

function timeline(kind,detail={}){
  const row={at:now(),iso:iso(),stage:active.stage,cycle:active.cycle,kind,...detail};
  active.timeline.push(row);
  if(active.timeline.length>4000)active.timeline.splice(0,active.timeline.length-3000);
  return row;
}

function seeded(seed){
  let value=seed>>>0;
  return()=>{value^=value<<13;value^=value>>>17;value^=value<<5;return(value>>>0)/4294967296;};
}

function buildChaosCases(){
  const fixed=[
    {name:'both-simultaneous-short',downOrder:'simultaneous',upOrder:'simultaneous',downGapMs:0,upGapMs:0,backgroundMs:350,offline:'none'},
    {name:'host-first-down-50',downOrder:'host-first',upOrder:'simultaneous',downGapMs:50,upGapMs:0,backgroundMs:500,offline:'none'},
    {name:'guest-first-down-50',downOrder:'guest-first',upOrder:'simultaneous',downGapMs:50,upGapMs:0,backgroundMs:500,offline:'none'},
    {name:'host-first-down-500',downOrder:'host-first',upOrder:'guest-first',downGapMs:500,upGapMs:250,backgroundMs:650,offline:'none'},
    {name:'guest-first-down-500',downOrder:'guest-first',upOrder:'host-first',downGapMs:500,upGapMs:250,backgroundMs:650,offline:'none'},
    {name:'near-simultaneous-resume-host',downOrder:'simultaneous',upOrder:'host-first',downGapMs:0,upGapMs:50,backgroundMs:700,offline:'none'},
    {name:'near-simultaneous-resume-guest',downOrder:'simultaneous',upOrder:'guest-first',downGapMs:0,upGapMs:50,backgroundMs:700,offline:'none'},
    {name:'host-offline-while-guest-restores',downOrder:'simultaneous',upOrder:'guest-first',downGapMs:0,upGapMs:350,backgroundMs:900,offline:'host'},
    {name:'guest-offline-while-host-restores',downOrder:'simultaneous',upOrder:'host-first',downGapMs:0,upGapMs:350,backgroundMs:900,offline:'guest'},
    {name:'both-offline-near-resume',downOrder:'simultaneous',upOrder:'host-first',downGapMs:0,upGapMs:80,backgroundMs:1200,offline:'both'},
    {name:'both-simultaneous-long',downOrder:'simultaneous',upOrder:'guest-first',downGapMs:0,upGapMs:300,backgroundMs:10000,offline:'none'},
    {name:'post-commit-burst',downOrder:'host-first',upOrder:'guest-first',downGapMs:120,upGapMs:120,backgroundMs:300,offline:'none'},
  ];
  const random=seeded(CHAOS_SEED),orders=['simultaneous','host-first','guest-first'],offline=['none','none','none','host','guest','both'];
  const cases=[...fixed];
  while(cases.length<CHAOS_CYCLES){
    const index=cases.length,downOrder=orders[Math.floor(random()*orders.length)],upOrder=orders[Math.floor(random()*orders.length)];
    cases.push({
      name:`seed-${CHAOS_SEED}-cycle-${index}`,
      downOrder,upOrder,
      downGapMs:downOrder==='simultaneous'?0:50+Math.floor(random()*451),
      upGapMs:upOrder==='simultaneous'?0:50+Math.floor(random()*451),
      backgroundMs:250+Math.floor(random()*1751),
      offline:offline[Math.floor(random()*offline.length)],
    });
  }
  return cases;
}

async function waitUntil(fn,{timeout=60000,interval=250,label='condition'}={}){
  const deadline=now()+timeout;let last=null,lastError=null;
  while(now()<deadline){
    try{last=await fn();if(last)return last;}catch(error){lastError=error;}
    await sleep(interval);
  }
  throw new Error(`${label}_TIMEOUT:last=${JSON.stringify(last)}:error=${String(lastError||'')}`);
}

async function waitForDevice(client,timeout=180000){
  await waitUntil(async()=>{
    try{return adb(client,'get-state').trim()==='device';}catch{return false;}
  },{timeout,interval:1000,label:`${client.name}_ADB_DEVICE`});
  await waitUntil(async()=>{
    try{return adb(client,'shell','getprop','sys.boot_completed').trim()==='1';}catch{return false;}
  },{timeout,interval:1000,label:`${client.name}_ANDROID_BOOT`});
}

function secondaryAvdManager(){
  const sdk=process.env.ANDROID_HOME||process.env.ANDROID_SDK_ROOT;
  if(!sdk)throw new Error('ANDROID_SDK_ROOT_MISSING');
  const candidates=[path.join(sdk,'cmdline-tools','latest','bin','avdmanager'),path.join(sdk,'cmdline-tools','bin','avdmanager')];
  const manager=candidates.find(file=>fs.existsSync(file));
  if(!manager)throw new Error(`AVDMANAGER_MISSING:${candidates.join(',')}`);
  return{sdk,manager,emulator:path.join(sdk,'emulator','emulator')};
}

async function startSecondaryEmulator(){
  const guest=CLIENTS[1],{sdk,manager,emulator}=secondaryAvdManager();
  active.stage='secondary-avd-create';timeline('emulator-create-begin',{client:'guest',serial:guest.serial});
  try{runHost(manager,['delete','avd','-n',SECONDARY_AVD],{timeout:30000});}catch{}
  runHost(manager,['create','avd','--force','--name',SECONDARY_AVD,'--package','system-images;android-35;google_apis;x86_64','--device','pixel_6'],{input:'no\n',timeout:120000});
  const avdHome=process.env.ANDROID_AVD_HOME||path.join(process.env.HOME||'', '.android','avd');
  const config=path.join(avdHome,`${SECONDARY_AVD}.avd`,'config.ini');
  if(fs.existsSync(config))fs.appendFileSync(config,'\nhw.ramSize=1536\nhw.cpu.ncore=2\nvm.heapSize=256\n');
  active.secondaryLogFd=fs.openSync(path.join(OUTPUT,'secondary-emulator.log'),'a');
  active.secondary=spawn(emulator,[
    '-avd',SECONDARY_AVD,'-port','5556','-no-window','-gpu','swiftshader_indirect','-noaudio','-no-boot-anim',
    '-camera-back','none','-no-snapshot','-no-metrics','-memory','1536','-cores','2',
  ],{env:{...process.env,ANDROID_HOME:sdk},stdio:['ignore',active.secondaryLogFd,active.secondaryLogFd]});
  active.secondary.on('exit',(code,signal)=>timeline('emulator-exit',{client:'guest',code,signal}));
  await waitForDevice(guest,240000);
  adb(guest,'shell','settings','put','global','window_animation_scale','0');
  adb(guest,'shell','settings','put','global','transition_animation_scale','0');
  adb(guest,'shell','settings','put','global','animator_duration_scale','0');
  timeline('emulator-ready',{client:'guest',serial:guest.serial});
}

async function cdpConnect(client){
  try{adb(client,'forward','--remove',`tcp:${client.cdpPort}`);}catch{}
  adb(client,'forward',`tcp:${client.cdpPort}`,'localabstract:chrome_devtools_remote');
  return waitUntil(async()=>{
    try{
      const tabs=await(await fetch(`http://127.0.0.1:${client.cdpPort}/json`)).json();
      const tab=tabs.find(item=>item.type==='page'&&String(item.url||'').startsWith('https://10.0.2.2:8443'))||tabs.find(item=>item.type==='page');
      if(!tab)return false;
      const ws=new WebSocket(tab.webSocketDebuggerUrl);
      await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
      let id=0;const pending=new Map(),events=[];
      ws.onmessage=message=>{
        const packet=JSON.parse(message.data);
        if(packet.id&&pending.has(packet.id)){const handler=pending.get(packet.id);pending.delete(packet.id);handler(packet);}
        else if(packet.method){events.push({at:now(),method:packet.method,params:packet.params});if(events.length>500)events.shift();}
      };
      const send=(method,params={})=>new Promise((resolve,reject)=>{
        const commandId=++id;pending.set(commandId,packet=>packet.error?reject(new Error(JSON.stringify(packet.error))):resolve(packet.result));
        ws.send(JSON.stringify({id:commandId,method,params}));
      });
      await send('Runtime.enable');await send('Log.enable');await send('Network.enable');
      return{ws,send,events};
    }catch{return false;}
  },{timeout:90000,interval:500,label:`${client.name}_CHROME_CDP`});
}

async function evaluate(client,expression){
  const result=await client.cdp.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if(result.exceptionDetails)throw new Error(`${client.name}_EVALUATION_FAILED:${result.exceptionDetails.text}:${result.exceptionDetails.exception?.description||''}`);
  return result.result.value;
}

async function installPageTimeline(client){
  await evaluate(client,`(()=>{
    if(window.__cp32AndroidTimelineInstalled)return true;
    window.__cp32AndroidTimelineInstalled=true;window.__cp32AndroidTimeline=[];
    const summary=()=>{const runtime=window.OnlineRuntime?.debug?.()||null,pair=game?.order?.[game?.turn]||[],eligibility=game?window.InputLockManager?.evaluate?.(game)||null:null;return{at:Date.now(),visibility:document.visibilityState,online:navigator.onLine,runtimeState:runtime?.state||null,generation:Number(runtime?.generation||0),role:runtime?.role||null,matchId:runtime?.matchId||game?.matchId||null,routesReady:!!runtime?.routesReady,transportReady:!!runtime?.transport?.ready,activeBindingState:runtime?.transport?.activeBindingState||null,candidateBindingState:runtime?.transport?.candidateBindingState||null,restorePending:Number(runtime?.scope?.transactionCount||0)>0,revision:Number(game?.networkRevision||0),turnSerial:Number(game?.turnSerial||0),actorTeam:pair[0]??null,actorSlot:pair[1]??null,admissionPending:!!runtime?.actionAdmission?.pending,pendingTransaction:game?.pendingTransaction?.actionId||null,locks:window.InputLockManager?.snapshot?.()||[],eligibility:eligibility?{canAct:!!eligibility.canAct,reasons:[...(eligibility.reasons||[])],ownsCurrentActor:!!eligibility.ownsCurrentActor,manualLegalActionCount:Number(eligibility.manualLegalActionCount||0)}:null,enabledLegalActionCount:document.querySelectorAll('#actionButtons button:not([disabled])').length};};
    const push=(kind,detail={})=>{const rows=window.__cp32AndroidTimeline;rows.push({...summary(),kind,detail});if(rows.length>1200)rows.splice(0,rows.length-900);};
    document.addEventListener('visibilitychange',()=>push('visibilitychange'));
    window.addEventListener('online',()=>push('network-online'));
    window.addEventListener('offline',()=>push('network-offline'));
    window.addEventListener('pageshow',event=>push('pageshow',{persisted:!!event.persisted}));
    window.addEventListener('pagehide',event=>push('pagehide',{persisted:!!event.persisted}));
    window.EventBus?.on?.('*',event=>{const type=String(event?.type||'');if(/INPUT_|ACTION_TRANSACTION|BATTLE_ENDED|TURN_|PROJECTION|RESTORE|TRANSPORT/.test(type))push('event-bus',{type,token:event?.token||null,tokenOrReason:event?.tokenOrReason||null,actionId:event?.actionId||event?.payload?.actionId||null,transactionId:event?.transactionId||event?.payload?.transactionId||null});});
    push('timeline-installed');return true;
  })()`);
}

async function prepareChrome(client){
  active.stage=`prepare-chrome:${client.name}`;timeline('chrome-prepare-begin',{client:client.name,serial:client.serial});
  try{adb(client,'shell','am','force-stop',ANDROID_PACKAGE);}catch{}
  try{adb(client,'shell','pm','clear',ANDROID_PACKAGE);}catch{}
  const spki=requireLocalCandidateSpki();
  const commandLine=`chrome --ignore-certificate-errors-spki-list=${spki} --disable-fre --no-default-browser-check --disable-first-run-ui --remote-debugging-port=0`;
  const commandLinePath=path.join(PREFLIGHT,`chrome-command-line-${client.name}.txt`);
  fs.writeFileSync(commandLinePath,`${commandLine}\n`);
  adb(client,'push',commandLinePath,'/data/local/tmp/chrome-command-line');
  adb(client,'shell','am','start','-W','-a','android.intent.action.VIEW','-d',APP_URL,ANDROID_PACKAGE);
  client.cdp=await cdpConnect(client);active.clients.set(client.name,client);
  await waitUntil(()=>evaluate(client,"document.readyState==='complete'||document.readyState==='interactive'"),{timeout:60000,label:`${client.name}_PAGE_READY`});
  await installPageTimeline(client);
  const build=await evaluate(client,"document.querySelector('#cp32BuildIdentity')?.dataset.buildId||null");
  if(build!==BUILD_ID)throw new Error(`${client.name}_BUILD_IDENTITY_MISMATCH:${build}`);
  timeline('chrome-ready',{client:client.name,build});
}

async function elementGeometry(client,selector,index=0,{scroll=true}={}){
  return evaluate(client,`(()=>{
    const nodes=[...document.querySelectorAll(${JSON.stringify(selector)})],element=nodes[${Number(index)}];if(!element)return null;
    ${scroll?"element.scrollIntoView({block:'center',inline:'center'});":''}
    const r=element.getBoundingClientRect(),style=getComputedStyle(element),vv=window.visualViewport;
    return{selector:${JSON.stringify(selector)},index:${Number(index)},x:r.left,y:r.top,w:r.width,h:r.height,visible:!!(r.width&&r.height&&style.display!=='none'&&style.visibility!=='hidden'),disabled:!!element.disabled,pointerEvents:style.pointerEvents,text:(element.textContent||'').replace(/\\s+/g,' ').trim(),metrics:{innerWidth,innerHeight,outerWidth,outerHeight,screenWidth:screen.width,screenHeight:screen.height,availWidth:screen.availWidth,availHeight:screen.availHeight,screenX,screenY,devicePixelRatio,visualViewport:vv?{width:vv.width,height:vv.height,offsetLeft:vv.offsetLeft,offsetTop:vv.offsetTop,pageLeft:vv.pageLeft,pageTop:vv.pageTop,scale:vv.scale}:null}};
  })()`);
}

function physicalDisplay(client){
  const raw=adb(client,'shell','wm','size');const match=raw.match(/(?:Override|Physical) size:\s*(\d+)x(\d+)/i)||raw.match(/(\d+)x(\d+)/);
  if(!match)throw new Error(`${client.name}_WM_SIZE_UNPARSEABLE:${raw}`);
  return{width:Number(match[1]),height:Number(match[2]),raw:raw.trim()};
}

async function tapGeometry(client,geometry,label='target'){
  if(!geometry?.visible||geometry.disabled||geometry.pointerEvents==='none')throw new Error(`${client.name}_ANDROID_TARGET_UNAVAILABLE:${label}:${JSON.stringify(geometry)}`);
  const display=physicalDisplay(client),metrics=geometry.metrics||{};
  const screenWidth=Number(metrics.screenWidth||metrics.innerWidth||1),screenHeight=Number(metrics.screenHeight||metrics.outerHeight||metrics.innerHeight||1);
  const scaleX=display.width/screenWidth,scaleY=display.height/screenHeight;
  const contentTopCss=Math.max(0,Number(metrics.screenY||0)+Math.max(0,Number(metrics.outerHeight||screenHeight)-Number(metrics.innerHeight||screenHeight)));
  const x=Math.max(1,Math.min(display.width-2,Math.round((Number(geometry.x)+Number(geometry.w)/2+Number(metrics.screenX||0))*scaleX)));
  const y=Math.max(1,Math.min(display.height-2,Math.round((Number(geometry.y)+Number(geometry.h)/2+contentTopCss)*scaleY)));
  const rec={client:client.name,label,text:geometry.text,x,y,display,metrics,geometry:{x:geometry.x,y:geometry.y,w:geometry.w,h:geometry.h}};
  timeline('adb-touch',rec);record(`last-touch-${client.name}.json`,rec);
  adb(client,'shell','input','tap',String(x),String(y));
  await sleep(180);
  return rec;
}

async function tap(client,selector,index=0,options={}){
  const geometry=await elementGeometry(client,selector,index,options);
  return tapGeometry(client,geometry,`${selector}[${index}]`);
}

async function waitVisible(client,selector,timeout=60000){
  return waitUntil(async()=>{const geometry=await elementGeometry(client,selector,0,{scroll:false});return geometry?.visible?geometry:false;},{timeout,label:`${client.name}_${selector}_VISIBLE`});
}

async function selectedDeck(client){return evaluate(client,"[...document.querySelectorAll('#onlineRoomDeck .online-room-card.selected')].map(card=>card.dataset.cardId||null).filter(Boolean)");}
async function selectDeck(client){
  for(const cardId of BATTLE_DECK){
    const selected=await selectedDeck(client);if(selected.includes(cardId))continue;
    await tap(client,`#onlineRoomDeck .online-room-card[data-card-id="${cardId}"]`);
    await waitUntil(async()=>{const next=await selectedDeck(client);return next.includes(cardId)&&next.length<=4;},{timeout:15000,label:`${client.name}_DECK_${cardId}`});
  }
  const final=await selectedDeck(client),expected=[...BATTLE_DECK].sort(),actual=[...final].sort();if(JSON.stringify(actual)!==JSON.stringify(expected))throw new Error(`${client.name}_DECK_IDENTITY_MISMATCH:${JSON.stringify(final)}`);
  return final;
}

async function state(client,{full=false}={}){
  return evaluate(client,`(()=>{
    const runtime=window.OnlineRuntime?.debug?.()||null,pair=game?.order?.[game?.turn]||[],actor=pair[0]!=null?unitAt(game,pair[0],pair[1]):null;
    const units=team=>[...(game?.teams?.[team]?.field||[]),...(game?.teams?.[team]?.bench||[]),...(game?.teams?.[team]?.summons||[])].filter(Boolean);
    const sum=(list,key)=>list.reduce((total,unit)=>total+Math.max(0,Number(unit?.[key]||0)),0),energy=list=>list.reduce((total,unit)=>total+[...(unit?.energy||[]),...(unit?.beastEnergy||[]),...(unit?.riderEnergy||[])].reduce((value,item)=>value+Number(item?.a||0),0),0),p=units('P'),a=units('A');
    const eligibility=game?window.InputLockManager?.evaluate?.(game)||null:null,locks=window.InputLockManager?.snapshot?.()||[],clock=window.InputLockManager?.clockState?.()||null;
    const actionPanel=window.ActionPanelConvergenceOwner?.snapshot?.()||null,buttons=[...document.querySelectorAll('#actionButtons button')].filter(button=>!button.dataset.actionPanelMeta);
    const pending=game?.pendingTransaction||null,audit=window.TransactionAuditChannel?.snapshot?.()||[];
    const scheduled=[...p,...a].filter(unit=>unit?.scheduledAction).map(unit=>({uid:unit.uid,card:unit.card,team:(p.includes(unit)?'P':'A'),scheduledActionId:unit.scheduledAction.scheduledActionId||null,kind:unit.scheduledAction.kind||null,remaining:Number(unit.scheduledAction.remaining||0)}));
    const canonical=game?{matchId:game.matchId||runtime?.matchId||null,battleId:game.battleId||null,phase:game.phase||null,winner:game.winner||null,revision:Number(game.networkRevision||0),turnSerial:Number(game.turnSerial||0),eventSequence:Number(game.eventSequence||0),turn:Number(game.turn||0),actorTeam:pair[0]??null,actorSlot:pair[1]??null,actorUid:actor?.uid||game.activeEntityId||null,actorCard:actor?.card||null,P:{hp:sum(p,'hp'),energy:energy(p)},A:{hp:sum(a,'hp'),energy:energy(a)},pendingTransaction:pending?{actionId:pending.actionId||null,transactionId:pending.transactionId||null,state:pending.state||null}:null,pendingAction:game.pendingAction?.actionId||null,pendingPayment:!!game.pendingPayment,pendingAnimation:game.pendingAnimation?.id||null,scheduled}:null;
    const summary={client:${JSON.stringify(client.name)},expectedRole:${JSON.stringify(client.role)},visibility:document.visibilityState,online:navigator.onLine,build:document.querySelector('#cp32BuildIdentity')?.dataset.buildId||null,canonical,runtime:runtime?{state:runtime.state,generation:Number(runtime.generation||0),role:runtime.role||null,matchId:runtime.matchId||null,committed:runtime.committed===true,routesReady:runtime.routesReady===true,transport:runtime.transport?{ready:runtime.transport.ready===true,signalingState:runtime.transport.signalingState,dataConnectionState:runtime.transport.dataConnectionState,reconnectAttempt:Number(runtime.transport.reconnectAttempt||0),activeBindingId:runtime.transport.activeBindingId||null,activeBindingState:runtime.transport.activeBindingState||null,candidateBindingId:runtime.transport.candidateBindingId||null,candidateBindingState:runtime.transport.candidateBindingState||null,activeBindingCount:Number(runtime.transport.activeBindingCount||0),bindingCount:Number(runtime.transport.bindingCount||0),lastReceivedRelaySequence:Number(runtime.transport.lastReceivedRelaySequence||0)}:null,scope:runtime.scope?{generation:Number(runtime.scope.generation||0),phase:runtime.scope.phase||null,projectionEpoch:Number(runtime.scope.projectionEpoch||0),invalidated:!!runtime.scope.invalidated,closed:!!runtime.scope.closed,resourceCount:Number(runtime.scope.resourceCount||0),promiseCount:Number(runtime.scope.promiseCount||0),transactionCount:Number(runtime.scope.transactionCount||0)}:null}:null,admission:window.OnlineActionAdmissionOwner?.debug?.()||null,locks,clock,eligibility:eligibility?{canAct:!!eligibility.canAct,reasons:[...(eligibility.reasons||[])],ownsCurrentActor:!!eligibility.ownsCurrentActor,canonicalLocalTeam:eligibility.canonicalLocalTeam||null,currentActorCanonicalTeam:eligibility.currentActorCanonicalTeam||null,currentActorSlot:eligibility.currentActorSlot,currentActorUid:eligibility.currentActorUid||null,legalActionCount:Number(eligibility.legalActionCount||0),manualLegalActionCount:Number(eligibility.manualLegalActionCount||0),authoritativeRevision:Number(eligibility.authoritativeRevision||0),localAppliedRevision:Number(eligibility.localAppliedRevision||0),activeLocks:eligibility.activeLocks||[]}:null,actionPanel,projection:runtime?.projection||null,restore:runtime?.restore||null,enabledLegalActionCount:buttons.filter(button=>!button.disabled).length,actionButtons:buttons.map((button,index)=>({index,text:(button.textContent||'').replace(/\\s+/g,' ').trim(),disabled:!!button.disabled,ariaDisabled:button.getAttribute('aria-disabled'),skillId:button.dataset.skillId||null,connected:button.isConnected})),modal:{open:document.querySelector('#modal')?.classList.contains('open')||false,owner:document.querySelector('#modal')?.className||'',enabledButtons:document.querySelectorAll('#modal.open button:not([disabled])').length,targetables:document.querySelectorAll('.battle-unit-card.targetable,.summon-card.targetable').length},recoveredErrors:(window.__megaRecoveredErrors||[]).slice(-40),audit:audit.slice(-120)};
    if(${full?'true':'false'}){summary.full={runtime,scopeTrace:runtime?.scope?.trace||[],bindingTrace:runtime?.transport?.bindingTrace||[],recoveryTrace:runtime?.transport?.recoveryTrace||[],staleDropTrace:runtime?.transport?.staleDropTrace||[],restoreTrace:runtime?.restore||[],projectionTrace:runtime?.projection?.trace||[],admissionTrace:summary.admission?.resolutionTrace||[],transactionAudit:audit,pageTimeline:(window.__cp32AndroidTimeline||[]).slice(-1200),eventLog:(game?.eventLog||[]).slice(-240)};}
    return summary;
  })()`);
}

async function pairSnapshot({full=false,label='snapshot'}={}){
  const [host,guest]=await Promise.all(CLIENTS.map(client=>state(client,{full}).catch(error=>({client:client.name,snapshotError:String(error)}))));
  if(full){for(const value of [host,guest]){const client=CLIENTS.find(item=>item.name===value.client);if(value.full)value.full.cdpEvents=(client?.cdp?.events||[]).slice(-500);}}
  const snapshot={at:now(),iso:iso(),stage:active.stage,cycle:active.cycle,label,host,guest};
  timeline('pair-snapshot',{label,host:compact(host),guest:compact(guest)});
  return snapshot;
}

function compact(value){
  return{client:value?.client,visibility:value?.visibility,online:value?.online,runtimeState:value?.runtime?.state,generation:value?.runtime?.generation,role:value?.runtime?.role,routesReady:value?.runtime?.routesReady,transport:value?.runtime?.transport,canonical:value?.canonical,admissionPending:!!value?.admission?.pending,locks:value?.locks,eligibility:value?.eligibility,enabledLegalActionCount:value?.enabledLegalActionCount,modal:value?.modal};
}

function canonicalSame(host,guest){
  const h=host?.canonical,g=guest?.canonical;
  return !!h&&!!g&&h.matchId===g.matchId&&h.battleId===g.battleId&&h.revision===g.revision&&h.turnSerial===g.turnSerial&&h.turn===g.turn&&h.actorTeam===g.actorTeam&&h.actorSlot===g.actorSlot&&h.actorUid===g.actorUid&&h.P.hp===g.P.hp&&h.A.hp===g.A.hp&&h.P.energy===g.P.energy&&h.A.energy===g.A.energy&&h.winner===g.winner;
}

function stableInvariant(snapshot,{allowTerminal=false}={}){
  const {host,guest}=snapshot,h=host?.canonical,g=guest?.canonical;
  const failures=[];
  if(!canonicalSame(host,guest))failures.push('CANONICAL_DIVERGENCE');
  if(!h?.matchId||!h?.battleId)failures.push('MATCH_IDENTITY_MISSING');
  if(host?.runtime?.generation!==guest?.runtime?.generation)failures.push('SESSION_GENERATION_DIVERGENCE');
  for(const client of [host,guest]){
    const name=client?.client||'unknown',runtime=client?.runtime,transport=runtime?.transport;
    if(!allowTerminal&&!h?.winner&&runtime?.state!=='IN_BATTLE')failures.push(`${name}:RUNTIME_${runtime?.state||'MISSING'}`);
    if(!runtime?.committed)failures.push(`${name}:SESSION_NOT_COMMITTED`);
    if(!runtime?.routesReady)failures.push(`${name}:ROUTES_NOT_READY`);
    if(!transport?.ready||transport.activeBindingState!=='READY'||transport.activeBindingCount!==1||transport.candidateBindingId)failures.push(`${name}:TRANSPORT_NOT_READY`);
    if(client?.admission?.pending)failures.push(`${name}:PENDING_ADMISSION`);
    if(client?.canonical?.pendingTransaction||client?.canonical?.pendingAction||client?.canonical?.pendingPayment)failures.push(`${name}:PENDING_TRANSACTION`);
    if((client?.locks||[]).length||client?.clock?.locked)failures.push(`${name}:INPUT_LOCKED`);
    if(Number(runtime?.scope?.transactionCount||0)!==0)failures.push(`${name}:RESTORE_NOT_SETTLED`);
    const projection=client?.projection?.lastCommit;
    if(!h?.winner&&(!projection?.committed||projection.phase!=='IN_BATTLE'||Number(projection.canonicalRevision)!==Number(client?.canonical?.revision)))failures.push(`${name}:PROJECTION_NOT_SETTLED`);
    const panel=client?.actionPanel?.lastRequest;
    if(!h?.winner&&(!panel?.coherent||Number(panel.canonicalRevision)!==Number(client?.canonical?.revision)))failures.push(`${name}:ACTION_PANEL_NOT_COHERENT`);
  }
  if(!h?.winner){
    const owner=h.actorTeam==='P'?host:h.actorTeam==='A'?guest:null,other=owner===host?guest:host;
    if(!owner)failures.push('CURRENT_ACTOR_OWNER_UNKNOWN');
    else{
      if(owner.enabledLegalActionCount<1)failures.push(`${owner.client}:ALL_GREY_ENABLED_COUNT_ZERO`);
      if(!owner.eligibility?.canAct||!owner.eligibility?.ownsCurrentActor)failures.push(`${owner.client}:CANONICAL_ACTOR_INELIGIBLE:${(owner.eligibility?.reasons||[]).join(',')}`);
      if(other.enabledLegalActionCount!==0)failures.push(`${other.client}:REMOTE_ACTION_ENABLED`);
    }
  }
  return{ok:failures.length===0,failures,actorClient:h?.actorTeam==='P'?'host':h?.actorTeam==='A'?'guest':null};
}

async function waitStableInvariant(label,timeout=120000){
  let last=null,lastResult=null;
  try{
    await waitUntil(async()=>{last=await pairSnapshot({label});lastResult=stableInvariant(last);return lastResult.ok?last:false;},{timeout,interval:500,label:`DUAL_ANDROID_INVARIANT_${label}`});
  }catch(error){
    const wrapped=new Error(`DUAL_ANDROID_INVARIANT_FAILED:${label}:${JSON.stringify(lastResult)}:last=${JSON.stringify(last)}:cause=${String(error)}`);
    wrapped.cause=error;throw wrapped;
  }
  return{snapshot:last,invariant:lastResult};
}

async function setupRoom(){
  const [host,guest]=CLIENTS;
  active.stage='room-host-create';
  await tap(host,'#onlineBtn');await waitVisible(host,'#openRoomCode');await tap(host,'#openRoomCode');await waitVisible(host,'#p2pHost');await tap(host,'#p2pHost');
  const roomCode=await waitUntil(async()=>{const code=await evaluate(host,"(document.querySelector('#roomCodeText')?.textContent||'').trim()");return/^[A-Z2-9]{6}$/.test(code)?code:false;},{timeout:45000,label:'HOST_ROOM_CODE'});
  active.stage='room-guest-join';
  await tap(guest,'#onlineBtn');await waitVisible(guest,'#openRoomCode');await tap(guest,'#openRoomCode');await waitVisible(guest,'#p2pGuest');await tap(guest,'#p2pGuest');
  await waitVisible(guest,'#roomCodeInput');await tap(guest,'#roomCodeInput');adb(guest,'shell','input','text',roomCode);await tap(guest,'#joinRoom');
  await Promise.all(CLIENTS.map(client=>waitVisible(client,'#onlineRoomDeck',90000)));
  timeline('room-paired',{roomCode});record('room-pair.json',{ok:true,roomCode,clients:CLIENTS.map(({name,serial,role})=>({name,serial,role}))});
  active.stage='deck-selection';
  const hostDeck=await selectDeck(host);
  await waitUntil(()=>evaluate(guest,"(document.querySelector('#roomReadyState')?.textContent||'').includes('상대 덱 4/4')"),{timeout:45000,label:'GUEST_REMOTE_DECK'});
  const guestDeck=await selectDeck(guest);
  await waitUntil(()=>evaluate(host,"(document.querySelector('#roomReadyState')?.textContent||'').includes('상대 덱 4/4')"),{timeout:45000,label:'HOST_REMOTE_DECK'});
  active.stage='battle-start';
  const startOwner=await waitUntil(async()=>{
    for(const client of CLIENTS){const button=await elementGeometry(client,'#onlineRoomStart',0,{scroll:false});if(button?.visible&&!button.disabled)return client;}
    return false;
  },{timeout:45000,label:'START_BUTTON_OWNER'});
  await tap(startOwner,'#onlineRoomStart');
  await Promise.all(CLIENTS.map(client=>waitVisible(client,'#actions',90000)));
  const stable=await waitStableInvariant('initial-battle',120000);
  record('battle-start.json',{ok:true,roomCode,hostDeck,guestDeck,stable});
  return{roomCode,hostDeck,guestDeck};
}

async function enabledActionChoice(client,{aggressive=false,skillId=null}={}){
  return evaluate(client,`(()=>{
    const buttons=[...document.querySelectorAll('#actionButtons button:not([disabled])')].filter(button=>{const r=button.getBoundingClientRect(),s=getComputedStyle(button);return r.width&&r.height&&s.display!=='none'&&s.visibility!=='hidden'});
    const rows=buttons.map((button,index)=>{const text=(button.textContent||'').replace(/\\s+/g,' ').trim(),id=button.dataset.skillId||null;let score=0;if(/에너지\\s*모으기/.test(text))score=${aggressive?'5':'200'};if(id)score=${aggressive?'80':'20'};if(${JSON.stringify(skillId)}&&id===${JSON.stringify(skillId)})score=1000;if(${aggressive?'true':'false'}&&id){const pair=game?.order?.[game.turn]||[],unit=pair.length?unitAt(game,pair[0],pair[1]):null,skill=unit?card(unit)?.skills?.find(value=>value.id===id):null;if(skill?.tags?.includes('damage'))score+=200;if(skill?.tags?.includes('scheduled'))score+=30;}return{index,text,skillId:id,score};});
    rows.sort((a,b)=>b.score-a.score||a.index-b.index);return rows[0]||null;
  })()`);
}

async function resolveInteraction(client){
  for(let step=0;step<18;step++){
    const candidate=await evaluate(client,`(()=>{
      const visible=element=>{const r=element.getBoundingClientRect(),s=getComputedStyle(element);return!!(r.width&&r.height&&s.display!=='none'&&s.visibility!=='hidden'&&s.pointerEvents!=='none')};
      const modal=document.querySelector('#modal.open');
      if(modal){
        const confirm=[...modal.querySelectorAll('#manualPaymentConfirm,#interactionConfirm,button.primary,button[id$="Confirm"]')].find(button=>visible(button)&&!button.disabled&&!/취소|뒤로|닫기|연결 끊기|메뉴/.test((button.textContent||'').trim()));
        if(confirm){const all=[...document.querySelectorAll('button')];return{kind:'all-button',index:all.indexOf(confirm)};}
        const energy=[...modal.querySelectorAll('.manual-payment-energy button,.interaction-energy button,.energy button')].find(button=>visible(button)&&!button.disabled&&!button.classList.contains('chosen'));
        if(energy){const all=[...document.querySelectorAll('button')];return{kind:'all-button',index:all.indexOf(energy)};}
        const button=[...modal.querySelectorAll('button:not([disabled])')].find(value=>visible(value)&&!/취소|뒤로|닫기|연결 끊기|메뉴/.test((value.textContent||'').trim()));
        if(button){const all=[...document.querySelectorAll('button')];return{kind:'all-button',index:all.indexOf(button)};}
      }
      const target=[...document.querySelectorAll('.battle-unit-card.targetable,.summon-card.targetable')].find(visible);
      if(target){const all=[...document.querySelectorAll('.battle-unit-card.targetable,.summon-card.targetable')];return{kind:'target',index:all.indexOf(target)};}
      return null;
    })()`);
    if(!candidate)return;
    if(candidate.kind==='selector')await tap(client,candidate.selector,candidate.index);
    else if(candidate.kind==='all-button')await tap(client,'button',candidate.index);
    else await tap(client,'.battle-unit-card.targetable,.summon-card.targetable',candidate.index);
    await sleep(150);
  }
  throw new Error(`${client.name}_INTERACTION_DID_NOT_SETTLE`);
}

async function performTouchAction(client,options={}){
  const choice=await enabledActionChoice(client,options);if(!choice)throw new Error(`${client.name}_ENABLED_ACTION_MISSING`);
  timeline('canonical-action-touch-begin',{client:client.name,choice});
  await tap(client,'#actionButtons button:not([disabled])',choice.index);
  await resolveInteraction(client);
  return choice;
}

async function waitCanonicalCommit(before,choice,label,timeout=90000){
  const beforeHost=before.host,beforeGuest=before.guest,turnSerial=beforeHost.canonical.turnSerial,revision=beforeHost.canonical.revision;
  let last=null;
  await waitUntil(async()=>{
    last=await pairSnapshot({label:`${label}:commit-poll`});
    const h=last.host,g=last.guest,commits=(h.audit||[]).filter(row=>row.type==='ACTION_TRANSACTION_COMMITTED'&&Number(row.turnSerialBefore)===turnSerial);
    const changed=h.canonical?.turnSerial===turnSerial+1&&h.canonical?.revision===revision+1;
    return canonicalSame(h,g)&&changed&&commits.length===1&&!h.canonical.pendingTransaction&&!g.canonical.pendingTransaction&&!h.admission?.pending&&!g.admission?.pending&&!(h.locks||[]).length&&!(g.locks||[]).length?last:false;
  },{timeout,interval:350,label:`CANONICAL_COMMIT_${label}`});
  const commit=last.host.audit.filter(row=>row.type==='ACTION_TRANSACTION_COMMITTED'&&Number(row.turnSerialBefore)===turnSerial);
  const begin=last.host.audit.find(row=>row.type==='ACTION_TRANSACTION_BEGAN'&&row.actionId===commit[0]?.actionId);
  if(!begin?.action||!commit[0]?.actionId)throw new Error(`ACTION_AUDIT_INCOMPLETE:${label}:${JSON.stringify({begin,commit})}`);
  const result={label,choice,beforeRevision:revision,afterRevision:last.host.canonical.revision,beforeTurnSerial:turnSerial,afterTurnSerial:last.host.canonical.turnSerial,begin,commit:commit[0],after:last};
  timeline('canonical-action-committed',{label,actionId:commit[0].actionId,revision:last.host.canonical.revision,turnSerial:last.host.canonical.turnSerial});
  return result;
}

async function touchAndCommit(label,{aggressive=false,skillId=null}={}){
  const stable=await waitStableInvariant(`${label}:before-touch`),before=stable.snapshot,actorName=stable.invariant.actorClient;
  const client=CLIENTS.find(item=>item.name===actorName);if(!client)throw new Error(`ACTOR_CLIENT_UNKNOWN:${JSON.stringify(stable.invariant)}`);
  const choice=await performTouchAction(client,{aggressive,skillId});
  return waitCanonicalCommit(before,choice,label);
}

async function home(client){timeline('lifecycle-command',{client:client.name,event:'HOME'});await adbAsync(client,'shell','input','keyevent','KEYCODE_HOME');}
async function foreground(client){timeline('lifecycle-command',{client:client.name,event:'FOREGROUND'});await adbAsync(client,'shell','am','start','-W','-n',`${ANDROID_PACKAGE}/${ANDROID_ACTIVITY}`);}
async function setOffline(client,offline){
  timeline('transport-command',{client:client.name,event:offline?'OS_OFFLINE':'OS_ONLINE'});
  adb(client,'shell','cmd','connectivity','airplane-mode',offline?'enable':'disable');
  try{adb(client,'shell','svc','wifi',offline?'disable':'enable');}catch{}
  try{adb(client,'shell','svc','data',offline?'disable':'enable');}catch{}
  const setting=adb(client,'shell','settings','get','global','airplane_mode_on').trim();
  if((offline&&setting!=='1')||(!offline&&setting!=='0'))throw new Error(`${client.name}_AIRPLANE_MODE_NOT_${offline?'ENABLED':'DISABLED'}:${setting}`);
}

async function orderedPair(first,second,order,gapMs,operation){
  if(order==='simultaneous'){await Promise.all([operation(first),operation(second)]);return;}
  const ordered=order==='host-first'?[first,second]:[second,first];await operation(ordered[0]);if(gapMs)await sleep(gapMs);await operation(ordered[1]);
}

function offlineClients(mode){if(mode==='both')return CLIENTS;if(mode==='host')return[CLIENTS[0]];if(mode==='guest')return[CLIENTS[1]];return[];}

async function dualLifecycleCase(spec,index){
  active.cycle=index;active.spec=spec;active.stage=`chaos:${index}:${spec.name}:pre-background`;
  const pre=await waitStableInvariant(`${spec.name}:pre-background`);
  const [host,guest]=CLIENTS;
  await orderedPair(host,guest,spec.downOrder,spec.downGapMs,home);
  active.stage=`chaos:${index}:${spec.name}:background`;timeline('dual-background-entered',{spec});
  for(const client of offlineClients(spec.offline))setOffline(client,true);
  await sleep(spec.backgroundMs);
  const offline=offlineClients(spec.offline);
  active.stage=`chaos:${index}:${spec.name}:resume`;
  if(offline.length){
    await orderedPair(host,guest,spec.upOrder,spec.upGapMs,foreground);
    await sleep(350);
    for(const client of offline)setOffline(client,false);
  }else await orderedPair(host,guest,spec.upOrder,spec.upGapMs,foreground);
  timeline('dual-foreground-entered',{spec});
  active.stage=`chaos:${index}:${spec.name}:invariant`;
  const restored=await waitStableInvariant(`${spec.name}:post-restore`,150000);
  active.stage=`chaos:${index}:${spec.name}:actual-touch`;
  const actor=CLIENTS.find(client=>client.name===restored.invariant.actorClient);
  const choice=await performTouchAction(actor);
  const committed=await waitCanonicalCommit(restored.snapshot,choice,`${spec.name}:post-restore-touch`,120000);
  const result={ok:true,index,spec,pre,restored,committed};record(`chaos-${String(index).padStart(2,'0')}-${spec.name}.json`,result);
  return result;
}

async function tryPendingModalCase(){
  active.stage='special:pending-modal:prepare';
  for(let attempt=0;attempt<16;attempt++){
    const stable=await waitStableInvariant(`pending-modal-attempt-${attempt}`),actor=CLIENTS.find(client=>client.name===stable.invariant.actorClient);
    const skill=await enabledActionChoice(actor,{aggressive:true});
    if(skill?.skillId){
      const before=stable.snapshot;await tap(actor,'#actionButtons button:not([disabled])',skill.index);await sleep(250);
      const interaction=await state(actor);
      if(interaction.modal.open||interaction.modal.targetables>0){
        active.stage='special:pending-modal:dual-background';
        await Promise.all(CLIENTS.map(home));await sleep(600);await Promise.all(CLIENTS.map(foreground));
        const restored=await waitStableInvariant('pending-modal-post-restore',150000);
        const owner=CLIENTS.find(client=>client.name===restored.invariant.actorClient),choice=await performTouchAction(owner);
        const committed=await waitCanonicalCommit(restored.snapshot,choice,'pending-modal-post-restore-touch',120000);
        const result={ok:true,attempt,skill,before,interaction,restored,committed};record('pending-modal-dual-background.json',result);return result;
      }
      await resolveInteraction(actor);await waitCanonicalCommit(before,skill,`pending-modal-immediate-${attempt}`,120000);
      continue;
    }
    await touchAndCommit(`pending-modal-energy-${attempt}`);
  }
  throw new Error('PENDING_MODAL_ACTUAL_UI_CASE_NOT_REACHED');
}

async function createScheduledAction(){
  active.stage='special:scheduled-action:prepare';
  for(let attempt=0;attempt<32;attempt++){
    const stable=await waitStableInvariant(`scheduled-attempt-${attempt}`),actor=CLIENTS.find(client=>client.name===stable.invariant.actorClient),card=stable.snapshot.host.canonical.actorCard;
    const wanted=card==='galewing'?'galeGlide':card==='shuvi'?'shuviGlide':null;
    if(wanted){
      const choice=await enabledActionChoice(actor,{skillId:wanted});
      if(choice?.skillId===wanted){
        const before=stable.snapshot;await performTouchAction(actor,{skillId:wanted});const committed=await waitCanonicalCommit(before,choice,'scheduled-action-create',120000);
        const after=committed.after,scheduled=after.host.canonical.scheduled;
        if(scheduled.length!==1||after.guest.canonical.scheduled.length!==1||scheduled[0].scheduledActionId!==after.guest.canonical.scheduled[0].scheduledActionId)throw new Error(`SCHEDULED_IDENTITY_NOT_EXACTLY_ONE:${JSON.stringify({host:scheduled,guest:after.guest.canonical.scheduled})}`);
        active.stage='special:scheduled-action:dual-background';await Promise.all(CLIENTS.map(home));for(const client of CLIENTS)setOffline(client,true);await sleep(1200);await Promise.all(CLIENTS.map(foreground));await sleep(300);for(const client of CLIENTS)setOffline(client,false);
        const restored=await waitStableInvariant('scheduled-action-post-restore',150000),restoredScheduled=restored.snapshot.host.canonical.scheduled;
        if(restoredScheduled.length!==1||restoredScheduled[0].scheduledActionId!==scheduled[0].scheduledActionId||restored.snapshot.guest.canonical.scheduled.length!==1)throw new Error(`SCHEDULED_IDENTITY_DIVERGED_AFTER_RESTORE:${JSON.stringify(restored.snapshot)}`);
        const owner=CLIENTS.find(client=>client.name===restored.invariant.actorClient),nextChoice=await performTouchAction(owner),nextCommit=await waitCanonicalCommit(restored.snapshot,nextChoice,'scheduled-action-post-restore-touch',120000);
        const result={ok:true,wanted,committed,scheduled:scheduled[0],restored,nextCommit};record('scheduled-action-dual-background.json',result);return result;
      }
    }
    await touchAndCommit(`scheduled-energy-${attempt}`);
  }
  throw new Error('SCHEDULED_ACTION_ACTUAL_UI_CASE_NOT_REACHED');
}

async function playNaturalTerminal(){
  active.stage='terminal:natural-ui';const history=[];
  for(let action=0;action<180;action++){
    const snapshot=await pairSnapshot({label:`terminal-${action}:pre`});
    if(snapshot.host.canonical?.winner&&snapshot.guest.canonical?.winner){
      if(snapshot.host.canonical.winner!==snapshot.guest.canonical.winner)throw new Error(`TERMINAL_WINNER_DIVERGENCE:${JSON.stringify(snapshot)}`);
      const result={ok:true,actions:action,winner:snapshot.host.canonical.winner,history};record('natural-terminal.json',result);return result;
    }
    if(action>0&&action%7===0){
      active.stage=`terminal:near-action:${action}:dual-background`;await Promise.all(CLIENTS.map(home));await sleep(action%14===0?1200:350);const order=action%14===0?'guest-first':'host-first';await orderedPair(CLIENTS[0],CLIENTS[1],order,100,foreground);await waitStableInvariant(`terminal-background-${action}`,150000);
    }
    const stable=await waitStableInvariant(`terminal-action-${action}`),before=stable.snapshot,actor=CLIENTS.find(client=>client.name===stable.invariant.actorClient),choice=await performTouchAction(actor,{aggressive:true});
    try{const committed=await waitCanonicalCommit(before,choice,`terminal-action-${action}`,120000);history.push({action,choice,revision:committed.afterRevision,turnSerial:committed.afterTurnSerial});}
    catch(error){
      const after=await pairSnapshot({label:`terminal-${action}:commit-failure-check`});
      if(after.host.canonical?.winner&&after.host.canonical.winner===after.guest.canonical?.winner){history.push({action,choice,terminal:true,winner:after.host.canonical.winner});continue;}
      throw error;
    }
  }
  throw new Error(`NATURAL_TERMINAL_NOT_REACHED:${JSON.stringify(history.slice(-20))}`);
}

function startVideo(client){
  const remote=`/sdcard/cp32-${client.name}.mp4`,logFd=fs.openSync(path.join(OUTPUT,`screenrecord-${client.name}.log`),'a');
  const child=spawn(ADB,['-s',client.serial,'shell','screenrecord','--time-limit','180',remote],{stdio:['ignore',logFd,logFd]});
  active.videos.set(client.name,{child,remote,logFd});
}

function stopVideos(){
  for(const [name,video]of active.videos){try{video.child.kill('SIGINT');}catch{}try{fs.closeSync(video.logFd);}catch{}const client=CLIENTS.find(item=>item.name===name);try{adb(client,'pull',video.remote,path.join(OUTPUT,`${name}.mp4`));}catch{}}
}

function captureClientEvidence(client){
  let exitCode=0,stderr='';
  try{record(`logcat-${client.name}.txt`,execFileSync(ADB,['-s',client.serial,'logcat','-d'],{encoding:'utf8',timeout:30000}));}catch(error){exitCode=Number(error?.status||1);stderr=String(error?.stderr||error);record(`logcat-${client.name}.txt`,String(error?.stdout||''));}
  record(`logcat-${client.name}.stderr.log`,stderr);
  try{record(`screenshot-${client.name}.png`,execFileSync(ADB,['-s',client.serial,'exec-out','screencap','-p'],{timeout:30000}));}catch{}
  return{client:client.name,serial:client.serial,exitCode,stdoutPath:`artifacts/android/logcat-${client.name}.txt`,stderrPath:`artifacts/android/logcat-${client.name}.stderr.log`};
}

function chronologyFromPair(pair){
  const chronology=[];
  for(const side of ['host','guest']){
    const full=pair?.[side]?.full||{};
    for(const [source,rows]of Object.entries({page:full.pageTimeline,scope:full.scopeTrace,binding:full.bindingTrace,recovery:full.recoveryTrace,restore:full.restoreTrace,projection:full.projectionTrace,admission:full.admissionTrace,audit:full.transactionAudit,cdp:full.cdpEvents}))for(const row of rows||[]){
      let message=null;
      if(source==='cdp'&&/^Network\.webSocketFrame(?:Received|Sent)$/.test(row.method||'')){
        const raw=row.params?.response?.payloadData||'';try{const envelope=JSON.parse(raw),payload=envelope?.payload||envelope?.packet?.payload||null;message={direction:row.method.endsWith('Received')?'received':'sent',envelopeType:envelope?.type||null,messageType:payload?.type||envelope?.packet?.type||null,relaySequence:Number(envelope?.relaySequence||envelope?.packet?.relaySequence||0),revision:Number(payload?.revision||payload?.latestAuthoritativeRevision||0),turnSerial:Number(payload?.turnSerial??payload?.expectedTurnSerial??-1),actionId:payload?.actionId||payload?.ackActionId||payload?.actionResolution?.actionId||null,restoreRequestId:envelope?.restoreRequestId||payload?.restoreRequestId||null};}catch{}
      }
      chronology.push({side,source,at:Number(row.at||row.timestamp||row.createdAt||0),message,row});
    }
  }
  chronology.sort((a,b)=>a.at-b.at||a.side.localeCompare(b.side)||a.source.localeCompare(b.source));
  return chronology;
}

async function failureEvidence(error){
  const pair=await pairSnapshot({full:true,label:'failure'}).catch(snapshotError=>({snapshotError:String(snapshotError)}));
  const chronology=chronologyFromPair(pair);
  const result={ok:false,classification:'UNCLASSIFIED_UNTIL_EVIDENCE_REVIEW',error:String(error),stack:error?.stack||null,stage:active.stage,cycle:active.cycle,spec:active.spec,at:iso(),seed:CHAOS_SEED,cycles:CHAOS_CYCLES,pair,driverTimeline:active.timeline,chronology};
  record('android-result.json',result);record('android-failure.json',result);record('arrival-order-chronology.json',chronology);
  return result;
}

function cleanup(){
  for(const client of CLIENTS){try{setOffline(client,false);}catch{}try{adb(client,'shell','am','start','-n',`${ANDROID_PACKAGE}/${ANDROID_ACTIVITY}`);}catch{}try{client.cdp?.ws?.close();}catch{}try{adb(client,'forward','--remove',`tcp:${client.cdpPort}`);}catch{}}
  stopVideos();
  if(active.secondary){try{adb(CLIENTS[1],'emu','kill');}catch{}try{active.secondary.kill('SIGTERM');}catch{}}
  if(active.secondaryLogFd!=null)try{fs.closeSync(active.secondaryLogFd);}catch{}
}

async function main(){
  const cases=buildChaosCases();record('chaos-seed.json',{seed:CHAOS_SEED,normalizedUint32Seed:CHAOS_SEED>>>0,cycles:CHAOS_CYCLES,cases,generatedAt:iso()});
  let failure=null;
  try{
    active.stage='primary-device';await waitForDevice(CLIENTS[0]);
    await startSecondaryEmulator();
    active.stage='prepare-both-clients';await Promise.all(CLIENTS.map(prepareChrome));
    await setupRoom();
    CLIENTS.forEach(startVideo);
    const chaos=[];for(let index=0;index<cases.length;index++)chaos.push(await dualLifecycleCase(cases[index],index));
    active.cycle=null;active.spec=null;
    const pendingModal=await tryPendingModalCase();
    const scheduledAction=await createScheduledAction();
    const terminal=await playNaturalTerminal();
    active.stage='complete';
    const final=await pairSnapshot({full:true,label:'complete'});
    const chronology=chronologyFromPair(final);record('arrival-order-chronology.json',chronology);
    const result={ok:true,classification:'PASS',completedAt:iso(),seed:CHAOS_SEED,cycles:cases.length,chaos:chaos.map(row=>({index:row.index,spec:row.spec,revision:row.committed.afterRevision,turnSerial:row.committed.afterTurnSerial})),pendingModal:{ok:pendingModal.ok},scheduledAction:{ok:scheduledAction.ok,id:scheduledAction.scheduled.scheduledActionId},terminal,final,driverTimeline:active.timeline,chronology};
    record('android-result.json',result);
  }catch(error){failure=error;await failureEvidence(error);throw error;}
  finally{
    active.stage=failure?'cleanup-after-failure':'cleanup-after-pass';
    const captures=CLIENTS.map(captureClientEvidence);record('logcat-capture.json',{owner:'dual-android-driver-before-emulator-cleanup',captures});
    fs.writeFileSync(path.join(PREFLIGHT,'android-logcat-capture.json'),JSON.stringify({owner:'dual-android-driver-before-emulator-cleanup',captures},null,2));
    cleanup();
  }
}

main().catch(error=>{console.error(error?.stack||error);process.exit(2);});

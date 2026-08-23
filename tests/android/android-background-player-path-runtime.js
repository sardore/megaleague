import fs from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';

const sourcePath=fileURLToPath(new URL('./android-background-player-path.js',import.meta.url));
const generatedPath=path.join(path.dirname(sourcePath),'.android-background-player-path.generated.mjs');
const source=fs.readFileSync(sourcePath,'utf8');

const prepareStart=source.indexOf('async function prepareChrome(client){');
const prepareEnd=source.indexOf('async function elementGeometry(client,selector,index=0,{scroll=true}={}){');
if(prepareStart<0||prepareEnd<0||prepareEnd<=prepareStart)throw new Error(`ANDROID_RUNTIME_PREPARE_PATCH_ANCHOR_MISSING:${JSON.stringify({prepareStart,prepareEnd})}`);

async function patchedPrepareChrome(client){
  active.stage=`prepare-chrome:${client.name}`;timeline('chrome-prepare-begin',{client:client.name,serial:client.serial});
  try{adb(client,'shell','am','force-stop',ANDROID_PACKAGE);}catch{}
  try{adb(client,'shell','pm','clear',ANDROID_PACKAGE);}catch{}
  let notificationPermission='GRANTED';
  try{adb(client,'shell','pm','grant',ANDROID_PACKAGE,'android.permission.POST_NOTIFICATIONS');}
  catch(error){notificationPermission=`UNAVAILABLE:${String(error?.stderr||error?.message||error)}`;}
  timeline('chrome-notification-permission',{client:client.name,result:notificationPermission});
  try{adb(client,'reverse','--remove',`tcp:${APP_PORT}`);}catch(error){timeline('candidate-reverse-remove-miss',{client:client.name,error:String(error?.stderr||error?.message||error)});}
  const reverse=adb(client,'reverse',`tcp:${APP_PORT}`,`tcp:${APP_PORT}`).trim();
  timeline('candidate-reverse-bound',{client:client.name,devicePort:APP_PORT,hostPort:APP_PORT,result:reverse});
  const spki=requireLocalCandidateSpki();
  const commandLine=`chrome --ignore-certificate-errors-spki-list=${spki} --disable-fre --no-default-browser-check --disable-first-run-ui --remote-debugging-port=0`;
  const commandLinePath=path.join(PREFLIGHT,`chrome-command-line-${client.name}.txt`);
  fs.writeFileSync(commandLinePath,`${commandLine}\n`);
  adb(client,'push',commandLinePath,'/data/local/tmp/chrome-command-line');
  adb(client,'shell','am','start','-W','-a','android.intent.action.VIEW','-d',APP_URL,ANDROID_PACKAGE);
  client.cdp=await cdpConnect(client);
  const ready=await waitUntil(()=>evaluate(client,`(()=>{
    const runtimeMarker=document.querySelector('meta[name="cp32-online-runtime"]')?.content||null;
    const initialized=(document.readyState==='complete'||document.readyState==='interactive')&&typeof game!=='undefined'&&!!window.OnlineRuntime?.debug&&!!window.InputLockManager&&!!window.ActionPanelConvergenceOwner;
    return initialized?{runtimeMarker,runtimeVersion:window.OnlineRuntime.debug()?.version||null}:false;
  })()`),{timeout:60000,label:`${client.name}_CANDIDATE_RUNTIME_READY`});
  await installPageTimeline(client);
  timeline('chrome-ready',{client:client.name,runtimeMarker:ready.runtimeMarker,runtimeVersion:ready.runtimeVersion});
}

const prepareReplacement=patchedPrepareChrome.toString().replace('patchedPrepareChrome','prepareChrome')+'\n\n';
const readinessPatched=source.slice(0,prepareStart)+prepareReplacement+source.slice(prepareEnd);

const blockerStart=readinessPatched.indexOf('function knownChromeBlocker(nodes){');
const blockerEnd=readinessPatched.indexOf('async function androidWebContentFrame(client){');
if(blockerStart<0||blockerEnd<0||blockerEnd<=blockerStart)throw new Error(`ANDROID_RUNTIME_BLOCKER_PATCH_ANCHOR_MISSING:${JSON.stringify({blockerStart,blockerEnd})}`);

function patchedKnownChromeBlocker(nodes){
  const preferredIds=[
    'android:id/aerr_wait',
    `${ANDROID_PACKAGE}:id/negative_button`,
    'com.android.permissioncontroller:id/permission_deny_button',
    'com.google.android.permissioncontroller:id/permission_deny_button',
    'android:id/aerr_close',
  ];
  for(const resourceId of preferredIds){
    const node=nodes.find(row=>row['resource-id']===resourceId&&row.width>0&&row.height>0);
    if(node)return node;
  }
  return nodes.find(row=>row.class==='android.widget.Button'&&row.width>0&&row.height>0&&/^(Wait|Close app)$/i.test(String(row.text||'').trim()))||null;
}

const blockerReplacement=patchedKnownChromeBlocker.toString().replace('patchedKnownChromeBlocker','knownChromeBlocker')+'\n\n';
const blockerPatched=readinessPatched.slice(0,blockerStart)+blockerReplacement+readinessPatched.slice(blockerEnd);

const start=blockerPatched.indexOf('async function selectedDeck(client)');
const end=blockerPatched.indexOf('async function state(client,{full=false}={}){');
if(start<0||end<0||end<=start)throw new Error(`ANDROID_RUNTIME_DECK_PATCH_ANCHOR_MISSING:${JSON.stringify({start,end})}`);

async function patchedSelectedDeck(client){
  return evaluate(client,"[...document.querySelectorAll('#onlineRoomDeck .online-room-card.selected')].map(card=>card.dataset.cardId||null).filter(Boolean)");
}

async function patchedLiveDeckCandidates(client){
  return evaluate(client,`(()=>[...document.querySelectorAll('#onlineRoomDeck .online-room-card')].map((card,index)=>{const r=card.getBoundingClientRect(),s=getComputedStyle(card);return{id:card.dataset.cardId||null,index,selected:card.classList.contains('selected'),visible:!!(r.width&&r.height&&s.display!=='none'&&s.visibility!=='hidden'),text:(card.textContent||'').replace(/\\s+/g,' ').trim()};}).filter(row=>row.id))()`);
}

async function patchedSelectDeck(client){
  const initial=await liveDeckCandidates(client);
  if(initial.length<4)throw new Error(`${client.name}_LIVE_DECK_CANDIDATES_LT4:${JSON.stringify(initial)}`);
  record(`deck-candidates-${client.name}.json`,{requested:[...BATTLE_DECK],candidates:initial});
  while((await selectedDeck(client)).length<4){
    const before=await selectedDeck(client);
    const candidate=await evaluate(client,`(()=>{const cards=[...document.querySelectorAll('#onlineRoomDeck .online-room-card:not(.selected)')];for(let index=0;index<cards.length;index++){const card=cards[index],r=card.getBoundingClientRect(),s=getComputedStyle(card);if(!card.dataset.cardId||!r.width||!r.height||s.display==='none'||s.visibility==='hidden')continue;return{id:card.dataset.cardId,index,text:(card.textContent||'').replace(/\\s+/g,' ').trim()};}return null;})()`);
    if(!candidate?.id)throw new Error(`${client.name}_LIVE_DECK_UNSELECTED_CARD_MISSING:${JSON.stringify(await liveDeckCandidates(client))}`);
    await tap(client,'#onlineRoomDeck .online-room-card:not(.selected)',candidate.index);
    await waitUntil(async()=>{const next=await selectedDeck(client);return next.length===before.length+1&&next.includes(candidate.id)?next:false;},{timeout:15000,label:`${client.name}_DECK_LIVE_${candidate.id}`});
  }
  const final=await selectedDeck(client);
  if(final.length!==4)throw new Error(`${client.name}_DECK_COUNT_MISMATCH:${JSON.stringify(final)}`);
  timeline('live-deck-selected',{client:client.name,selected:final});
  record(`deck-selected-${client.name}.json`,{selected:final,candidates:await liveDeckCandidates(client)});
  return final;
}

const replacement=[
  patchedSelectedDeck.toString().replace('patchedSelectedDeck','selectedDeck'),
  patchedLiveDeckCandidates.toString().replace('patchedLiveDeckCandidates','liveDeckCandidates'),
  patchedSelectDeck.toString().replace('patchedSelectDeck','selectDeck'),
].join('\n\n')+'\n\n';

const transformed=blockerPatched.slice(0,start)+replacement+blockerPatched.slice(end);
fs.writeFileSync(generatedPath,transformed);
process.once('exit',()=>{try{fs.unlinkSync(generatedPath);}catch{}});
await import(`${pathToFileURL(generatedPath).href}?runtimeDeck=${Date.now()}`);

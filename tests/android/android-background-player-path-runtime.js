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
  await evaluate(client,`(()=>{
    if(window.__cp32AndroidInputTraceInstalled)return{installed:true,count:(window.__cp32AndroidInputTimeline||[]).length};
    window.__cp32AndroidInputTraceInstalled=true;
    window.__cp32AndroidInputTimeline=[];
    const describe=node=>{
      if(!node||node.nodeType!==1)return null;
      const action=node.closest?.('#actionButtons button')||null;
      return{
        tag:String(node.tagName||'').toLowerCase(),id:node.id||null,className:String(node.className||'').slice(0,240),
        text:String(node.textContent||'').replace(/\\s+/g,' ').trim().slice(0,240),
        actionText:action?String(action.textContent||'').replace(/\\s+/g,' ').trim().slice(0,240):null,
        actionDisabled:action?!!action.disabled:null,
      };
    };
    const capture=event=>{
      const point=event.touches?.[0]||event.changedTouches?.[0]||event;
      const row={
        at:Date.now(),perf:performance.now(),type:event.type,isTrusted:event.isTrusted===true,
        clientX:Number(point?.clientX??NaN),clientY:Number(point?.clientY??NaN),
        pageX:Number(point?.pageX??NaN),pageY:Number(point?.pageY??NaN),
        pointerType:event.pointerType||null,button:Number.isFinite(event.button)?event.button:null,
        target:describe(event.target),activeElement:describe(document.activeElement),visibility:document.visibilityState,
        path:(event.composedPath?.()||[]).slice(0,8).map(describe).filter(Boolean),
      };
      window.__cp32AndroidInputTimeline.push(row);
      if(window.__cp32AndroidInputTimeline.length>2000)window.__cp32AndroidInputTimeline.splice(0,window.__cp32AndroidInputTimeline.length-2000);
    };
    for(const type of ['pointerdown','pointerup','touchstart','touchend','mousedown','mouseup','click'])document.addEventListener(type,capture,true);
    return{installed:true,count:0};
  })()`);
  timeline('android-input-trace-installed',{client:client.name});
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

const frameStart=blockerPatched.indexOf('async function androidWebContentFrame(client){');
const frameEnd=blockerPatched.indexOf("async function tapGeometry(client,geometry,label='target'){");
if(frameStart<0||frameEnd<0||frameEnd<=frameStart)throw new Error(`ANDROID_RUNTIME_FRAME_PATCH_ANCHOR_MISSING:${JSON.stringify({frameStart,frameEnd})}`);

async function patchedAndroidWebContentFrame(client){
  let last=[];
  const readPageMetrics=()=>evaluate(client,`(()=>{
    const vv=window.visualViewport;
    return{
      origin:location.origin,
      visibility:document.visibilityState,
      ready:document.readyState,
      hasGame:typeof game!=='undefined',
      hasRuntime:!!window.OnlineRuntime?.debug,
      hasInput:!!window.InputLockManager,
      hasPanel:!!window.ActionPanelConvergenceOwner,
      innerWidth:Number(innerWidth||0),innerHeight:Number(innerHeight||0),
      outerWidth:Number(outerWidth||0),outerHeight:Number(outerHeight||0),
      screenWidth:Number(screen.width||0),screenHeight:Number(screen.height||0),
      dpr:Number(devicePixelRatio||1),
      visualViewport:vv?{width:Number(vv.width||0),height:Number(vv.height||0),offsetLeft:Number(vv.offsetLeft||0),offsetTop:Number(vv.offsetTop||0),scale:Number(vv.scale||1)}:null,
    };
  })()`);
  const pageUsable=page=>!!page&&page.origin===APP_ORIGIN&&page.visibility==='visible'&&(page.ready==='complete'||page.ready==='interactive')&&page.hasGame&&page.hasRuntime&&page.hasInput&&page.hasPanel&&page.innerWidth>0&&page.innerHeight>0;
  const visualSize=page=>({
    width:Number(page?.visualViewport?.width||page?.innerWidth||0),
    height:Number(page?.visualViewport?.height||page?.innerHeight||0),
  });
  const close=(a,b,tolerance=1)=>Math.abs(Number(a||0)-Number(b||0))<=tolerance;
  const viewportStable=(before,after)=>{
    if(!before||!after)return false;
    if(!close(before.innerWidth,after.innerWidth)||!close(before.innerHeight,after.innerHeight))return false;
    if(!close(before.screenWidth,after.screenWidth)||!close(before.screenHeight,after.screenHeight))return false;
    if(!close(before.dpr,after.dpr,0.01))return false;
    const a=before.visualViewport,b=after.visualViewport;
    if(!!a!==!!b)return false;
    if(a&&b&&(!close(a.width,b.width)||!close(a.height,b.height)||!close(a.offsetLeft,b.offsetLeft)||!close(a.offsetTop,b.offsetTop)||!close(a.scale,b.scale,0.01)))return false;
    return true;
  };
  const deriveFromChromeSurface=(nodes,currentDisplay,page)=>{
    if(!pageUsable(page))return null;
    const surfaces=nodes.filter(node=>node.package===ANDROID_PACKAGE&&node.class==='android.widget.FrameLayout'&&node.width>=currentDisplay.width*0.9&&node.height>=currentDisplay.height*0.5&&node.left>=0&&node.right<=currentDisplay.width&&node.top>=0&&node.bottom<=currentDisplay.height);
    const insetSurfaces=surfaces.filter(node=>node.top>0||node.bottom<currentDisplay.height);
    const candidates=(insetSurfaces.length?insetSurfaces:surfaces).sort((a,b)=>b.width*b.height-a.width*a.height);
    const surface=candidates[0];
    if(!surface)return null;
    const viewport=visualSize(page);
    const scale=surface.width/Number(viewport.width||1);
    const toolbarIds=/(?:home_button|location_bar|toolbar_buttons|tab_switcher_button|menu_button)$/;
    const toolbarBottom=nodes.filter(node=>node.package===ANDROID_PACKAGE&&toolbarIds.test(String(node['resource-id']||''))&&node.width>0&&node.height>0).reduce((value,node)=>Math.max(value,node.bottom),0);
    const keyboardTop=nodes.filter(node=>node.package===ANDROID_PACKAGE&&/(?:keyboard_accessory|bar_items_view)$/.test(String(node['resource-id']||''))&&node.width>0&&node.height>0&&node.top>(toolbarBottom||0)).reduce((value,node)=>Math.min(value,node.top),Infinity);
    const availableBottom=Number.isFinite(keyboardTop)?keyboardTop:surface.bottom;
    const expectedHeight=Math.round(Number(viewport.height||0)*scale);
    const inferredTop=availableBottom-expectedHeight;
    if(!Number.isFinite(scale)||scale<=0||expectedHeight<=0||inferredTop<surface.top||inferredTop>=availableBottom)return null;
    if(toolbarBottom&&Math.abs(toolbarBottom-inferredTop)>96)return null;
    const derived={left:surface.left,top:inferredTop,right:surface.right,bottom:availableBottom,width:surface.width,height:expectedHeight,display:currentDisplay,resourceId:'derived:chrome-surface-cdp-visual-viewport',verifiedAt:now(),pageMetrics:page,calibrationSource:'chrome-surface-cdp-visual-viewport',surface:{left:surface.left,top:surface.top,right:surface.right,bottom:surface.bottom,width:surface.width,height:surface.height},toolbarBottom:toolbarBottom||null,keyboardTop:Number.isFinite(keyboardTop)?keyboardTop:null};
    return derived;
  };

  const display=physicalDisplay(client);
  const cached=client.verifiedContentFrame;
  if(cached&&cached.display?.width===display.width&&cached.display?.height===display.height){
    let page=null;
    try{page=await readPageMetrics();}catch{}
    if(pageUsable(page)&&viewportStable(cached.pageMetrics,page)){
      const reused={...cached,display,pageMetrics:page,cacheFallback:true,usedAt:now()};
      timeline('android-web-content-frame-cache-hit',{client:client.name,verifiedAt:cached.verifiedAt,ageMs:now()-Number(cached.verifiedAt||0),display,page,calibrationSource:cached.calibrationSource||null});
      record(`last-web-content-frame-fallback-${client.name}.json`,{fallback:reused,page});
      return reused;
    }
    timeline('android-web-content-frame-cache-invalidated',{client:client.name,display,cachedDisplay:cached.display||null,cachedPage:cached.pageMetrics||null,page});
    client.verifiedContentFrame=null;
  }

  return waitUntil(async()=>{
    const hierarchy=androidUiHierarchy(client);last=hierarchy.nodes;
    const blocker=knownChromeBlocker(last);
    if(blocker){
      const x=Math.round((blocker.left+blocker.right)/2),y=Math.round((blocker.top+blocker.bottom)/2);
      const detail={client:client.name,resourceId:blocker['resource-id'],text:blocker.text||blocker['content-desc']||'',x,y,bounds:[blocker.left,blocker.top,blocker.right,blocker.bottom]};
      timeline('chrome-surface-blocker-dismissed',detail);record(`last-chrome-blocker-${client.name}.json`,detail);
      adb(client,'shell','input','tap',String(x),String(y));
      return false;
    }
    const currentDisplay=physicalDisplay(client);
    let page=null;
    try{page=await readPageMetrics();}catch{return false;}
    if(!pageUsable(page))return false;
    const webviews=last.filter(node=>node.class==='android.webkit.WebView'&&node.package===ANDROID_PACKAGE&&node.width>0&&node.height>0).sort((a,b)=>b.width*b.height-a.width*a.height);
    let verified=null;
    if(webviews.length){
      const view=webviews[0];
      if(view.left>=0&&view.top>=0&&view.right<=currentDisplay.width&&view.bottom<=currentDisplay.height){
        verified={left:view.left,top:view.top,right:view.right,bottom:view.bottom,width:view.width,height:view.height,display:currentDisplay,resourceId:view['resource-id']||null,verifiedAt:now(),pageMetrics:page,calibrationSource:'uiautomator-webview'};
      }
    }
    if(!verified)verified=deriveFromChromeSurface(last,currentDisplay,page);
    if(!verified)return false;
    const viewport=visualSize(page);
    const scaleX=verified.width/Number(viewport.width||1),scaleY=verified.height/Number(viewport.height||1);
    const relativeScaleError=Math.abs(scaleX-scaleY)/Math.max(scaleX,scaleY,1e-9);
    if(relativeScaleError>0.08)return false;
    verified.scaleCheck={x:scaleX,y:scaleY,relativeError:relativeScaleError,viewport};
    client.verifiedContentFrame=verified;
    timeline('android-web-content-frame-calibrated',{client:client.name,verified});
    record(`last-web-content-frame-calibrated-${client.name}.json`,verified);
    return verified;
  },{timeout:8000,interval:250,label:`${client.name}_ANDROID_WEB_CONTENT_FRAME`}).catch(error=>{
    const summary=last.map(node=>({class:node.class,package:node.package,resourceId:node['resource-id'],text:node.text,bounds:[node.left,node.top,node.right,node.bottom]}));
    throw new Error(`${client.name}_ANDROID_WEB_CONTENT_FRAME_FAILED:last=${JSON.stringify(summary)}:cause=${String(error)}`);
  });
}

const frameReplacement=patchedAndroidWebContentFrame.toString().replace('patchedAndroidWebContentFrame','androidWebContentFrame')+'\n\n';
const framePatched=blockerPatched.slice(0,frameStart)+frameReplacement+blockerPatched.slice(frameEnd);

const tapStart=framePatched.indexOf("async function tapGeometry(client,geometry,label='target'){");
const tapEnd=framePatched.indexOf('async function tap(client,selector,index=0,options={}){');
if(tapStart<0||tapEnd<0||tapEnd<=tapStart)throw new Error(`ANDROID_RUNTIME_TAP_PATCH_ANCHOR_MISSING:${JSON.stringify({tapStart,tapEnd})}`);

async function patchedTapGeometry(client,geometry,label='target'){
  if(!geometry?.visible||geometry.disabled||geometry.pointerEvents==='none')throw new Error(`${client.name}_ANDROID_TARGET_UNAVAILABLE:${label}:${JSON.stringify(geometry)}`);
  const contentFrame=await androidWebContentFrame(client),display=contentFrame.display,metrics=geometry.metrics||{};
  const viewportWidth=Number(metrics.visualViewport?.width||metrics.innerWidth||1),viewportHeight=Number(metrics.visualViewport?.height||metrics.innerHeight||1);
  const viewportOffsetLeft=Number(metrics.visualViewport?.offsetLeft||0),viewportOffsetTop=Number(metrics.visualViewport?.offsetTop||0);
  const scaleX=contentFrame.width/viewportWidth,scaleY=contentFrame.height/viewportHeight;
  const layoutCenterX=Number(geometry.x)+Number(geometry.w)/2,layoutCenterY=Number(geometry.y)+Number(geometry.h)/2;
  const centerX=layoutCenterX-viewportOffsetLeft,centerY=layoutCenterY-viewportOffsetTop;
  const x=Math.max(contentFrame.left+1,Math.min(contentFrame.right-2,Math.round(contentFrame.left+centerX*scaleX)));
  const y=Math.max(contentFrame.top+1,Math.min(contentFrame.bottom-2,Math.round(contentFrame.top+centerY*scaleY)));
  const inputBefore=await evaluate(client,`(()=>{
    const describe=node=>{if(!node||node.nodeType!==1)return null;const action=node.closest?.('#actionButtons button')||null;return{tag:String(node.tagName||'').toLowerCase(),id:node.id||null,className:String(node.className||'').slice(0,240),text:String(node.textContent||'').replace(/\\s+/g,' ').trim().slice(0,240),actionText:action?String(action.textContent||'').replace(/\\s+/g,' ').trim().slice(0,240):null,actionDisabled:action?!!action.disabled:null};};
    const trace=window.__cp32AndroidInputTimeline||[];
    return{length:trace.length,visualHit:describe(document.elementFromPoint(${JSON.stringify(centerX)},${JSON.stringify(centerY)})),layoutHit:describe(document.elementFromPoint(${JSON.stringify(layoutCenterX)},${JSON.stringify(layoutCenterY)})),activeElement:describe(document.activeElement),visibility:document.visibilityState};
  })()`);
  const cdpBefore=Array.isArray(client.cdp?.events)?client.cdp.events.length:0;
  const rec={client:client.name,label,text:geometry.text,x,y,display,contentFrame,scale:{x:scaleX,y:scaleY},viewport:{width:viewportWidth,height:viewportHeight,offsetLeft:viewportOffsetLeft,offsetTop:viewportOffsetTop,source:metrics.visualViewport?'visualViewport':'layoutViewport'},metrics,geometry:{x:geometry.x,y:geometry.y,w:geometry.w,h:geometry.h},inputBefore};
  timeline('adb-touch',rec);record(`last-touch-${client.name}.json`,rec);
  adb(client,'shell','input','tap',String(x),String(y));
  const isActionTap=label.includes('#actionButtons')||String(active.stage||'').includes('actual-touch');
  await sleep(isActionTap?900:180);
  const inputAfter=await evaluate(client,`(()=>{const trace=window.__cp32AndroidInputTimeline||[];return{length:trace.length,events:trace.slice(${Number(inputBefore?.length||0)}).slice(-40)};})()`).catch(error=>({error:String(error),length:null,events:[]}));
  const trustedEvents=(inputAfter.events||[]).filter(event=>event?.isTrusted===true);
  const actionTrustedEvents=trustedEvents.filter(event=>event?.target?.actionText);
  const cdpAfter=Array.isArray(client.cdp?.events)?client.cdp.events.slice(cdpBefore):[];
  const actionRequests=cdpAfter.filter(event=>{try{return JSON.stringify(event).includes('actionRequest');}catch{return false;}}).slice(-20);
  const delivery={client:client.name,label,stage:active.stage,at:now(),physical:{x,y},css:{layoutCenterX,layoutCenterY,visualCenterX:centerX,visualCenterY:centerY},inputBefore,inputAfter,trustedEventCount:trustedEvents.length,actionTrustedEventCount:actionTrustedEvents.length,actionRequestsObserved:actionRequests.length,actionRequestEvidence:actionRequests};
  timeline('android-touch-delivery',delivery);record(`last-touch-input-delivery-${client.name}.json`,delivery);
  if(isActionTap&&trustedEvents.length===0)throw new Error(`${client.name}_ANDROID_ADB_TOUCH_NOT_DELIVERED:${label}:${JSON.stringify(delivery)}`);
  if(isActionTap&&actionTrustedEvents.length===0)throw new Error(`${client.name}_ANDROID_ADB_TOUCH_TARGET_MISMATCH:${label}:${JSON.stringify(delivery)}`);
  if(isActionTap&&client.role==='guest'&&String(active.stage||'').includes('actual-touch')&&actionRequests.length===0){
    const post=await evaluate(client,`(()=>({canonical:typeof game!=='undefined'?{revision:Number(game.networkRevision||0),turnSerial:Number(game.turnSerial||0),pendingAction:game.pendingAction?.actionId||null,pendingTransaction:game.pendingTransaction||null}:null,admission:window.OnlineActionAdmissionOwner?.debug?.()||null,eligibility:window.InputLockManager?.evaluate?.(game)||null}))()`);
    delivery.post=post;record(`last-touch-input-delivery-${client.name}.json`,delivery);
    throw new Error(`${client.name}_ANDROID_TRUSTED_ACTION_NO_REQUEST:${label}:${JSON.stringify(delivery)}`);
  }
  return rec;
}

const tapReplacement=patchedTapGeometry.toString().replace('patchedTapGeometry','tapGeometry')+'\n\n';
const tapPatched=framePatched.slice(0,tapStart)+tapReplacement+framePatched.slice(tapEnd);

const start=tapPatched.indexOf('async function selectedDeck(client)');
const end=tapPatched.indexOf('async function state(client,{full=false}={}){');
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

const transformed=tapPatched.slice(0,start)+replacement+tapPatched.slice(end);
fs.writeFileSync(generatedPath,transformed);
process.once('exit',()=>{try{fs.unlinkSync(generatedPath);}catch{}});
await import(`${pathToFileURL(generatedPath).href}?runtimeDeck=${Date.now()}`);

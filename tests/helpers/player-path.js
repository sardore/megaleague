import { expect } from '@playwright/test';
export async function tap(page,selector){const l=page.locator(selector).first();await l.waitFor({state:'visible',timeout:30000});await expect(l).toBeEnabled();await expect.poll(async()=>l.evaluate(el=>{if(!(el instanceof HTMLElement)||el.matches(':disabled'))return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();if(s.display==='none'||s.visibility==='hidden'||s.pointerEvents==='none'||r.width<=0||r.height<=0)return false;const x=Math.max(0,Math.min(innerWidth-1,r.left+r.width/2)),y=Math.max(0,Math.min(innerHeight-1,r.top+r.height/2));const hit=document.elementFromPoint(x,y);return hit===el||!!el.contains(hit);}),{timeout:30000,message:`${selector} must be the actual topmost touch target`}).toBe(true);await l.tap();}
export async function openOnlineEntry(page){await tap(page,'#onlineBtn');}
export async function openAutoMatch(page){await openOnlineEntry(page);await tap(page,'#openAutoMatch');}
export async function createRoomHost(page){await openOnlineEntry(page);await tap(page,'#openRoomCode');await tap(page,'#p2pHost');await expect.poll(async()=>((await page.locator('#roomCodeText').textContent())||'').trim(),{timeout:30000}).toMatch(/^[A-Z2-9]{6}$/);return ((await page.locator('#roomCodeText').textContent())||'').trim();}
export async function joinRoomGuest(page,code){await openOnlineEntry(page);await tap(page,'#openRoomCode');await tap(page,'#p2pGuest');await page.locator('#roomCodeInput').fill(code);await tap(page,'#joinRoom');}
export async function pairByRoomCode(host,guest){const code=await createRoomHost(host);await joinRoomGuest(guest,code);await Promise.all([waitForLobby(host),waitForLobby(guest)]);return code;}
export async function waitForLobby(page){await page.locator('#onlineRoomDeck').waitFor({state:'visible',timeout:60000});await expect(page.locator('#modal')).toHaveClass(/online-room-r22/);await expect(page.locator('#onlineRoomDeck .online-room-card')).not.toHaveCount(0);}
export async function selectFour(page){for(let i=0;i<4;i++){const cards=page.locator('#onlineRoomDeck .online-room-card:not(.selected)');await expect.poll(()=>cards.count()).toBeGreaterThan(0);const card=cards.first();const b=await card.boundingBox();if(!b)throw new Error('CARD_SURFACE_DETACHED');await page.touchscreen.tap(b.x+b.width/2,b.y+Math.min(30,b.height/2));await expect.poll(async()=>page.locator('#onlineRoomDeck .online-room-card.selected').count()).toBe(i+1);}}
export async function waitRemoteCount(page,count){await expect(page.locator('#roomReadyState')).toContainText(`상대 덱 ${count}/4`,{timeout:30000});}
export async function startBattle(host,guest){const startHost=host.locator('#onlineRoomStart');const startGuest=guest.locator('#onlineRoomStart');await expect.poll(async()=>((await startHost.isEnabled().catch(()=>false))||(await startGuest.isEnabled().catch(()=>false))),{timeout:30000}).toBe(true);let target=null;if(await startHost.isEnabled().catch(()=>false))target=host;else if(await startGuest.isEnabled().catch(()=>false))target=guest;else throw new Error('READY_START_BUTTON_UNAVAILABLE');await tap(target,'#onlineRoomStart');await Promise.all([waitBattle(host),waitBattle(guest)]);}
export async function waitBattle(page){await page.locator('#actions').waitFor({state:'visible',timeout:60000});await page.locator('#actionButtons').waitFor({state:'visible'});await expect(page.locator('.online-coin-overlay')).toHaveCount(0,{timeout:60000});}
export async function touchFirstLegalAction(page){const buttons=page.locator('#actionButtons button:not([disabled]), #actionButtons .skillbtn:not([disabled])');await expect.poll(()=>buttons.count()).toBeGreaterThan(0);const button=buttons.first();const b=await button.boundingBox();if(!b)throw new Error('ACTION_BUTTON_DETACHED');await page.touchscreen.tap(b.x+b.width/2,b.y+b.height/2);await resolveInteraction(page);}
export async function resolveInteraction(page){
  const rejected=/취소|뒤로|닫기|연결 끊기|메뉴/;
  for(let i=0;i<12;i++){
    const modal=page.locator('#modal.open');
    if(await modal.count()){
      const preferred=modal.locator('button.primary:not([disabled]):visible,button[id$="Confirm"]:not([disabled]):visible');
      let chosen=null;
      for(let j=0;j<await preferred.count();j++){
        const candidate=preferred.nth(j),text=(await candidate.textContent()||'').trim();
        if(!rejected.test(text)){chosen=candidate;break}
      }
      if(!chosen){
        const candidates=modal.locator('button:not([disabled]):visible:not(.chosen)');
        for(let j=0;j<await candidates.count();j++){
          const candidate=candidates.nth(j),text=(await candidate.textContent()||'').trim();
          if(!rejected.test(text)){chosen=candidate;break}
        }
      }
      if(!chosen)return;
      const b=await chosen.boundingBox();if(!b)return;
      await page.touchscreen.tap(b.x+b.width/2,b.y+b.height/2);await page.waitForTimeout(60);continue;
    }
    const targets=page.locator('.battle-unit-card.targetable:visible,.summon-card.targetable:visible');
    if(await targets.count()){
      const target=targets.first(),b=await target.boundingBox();if(!b)return;
      await page.touchscreen.tap(b.x+b.width/2,b.y+b.height/2);await page.waitForTimeout(60);continue;
    }
    return;
  }
}
export async function canonicalBattleState(page){return page.evaluate(()=>{const runtime=window.OnlineRuntime?.debug?.()||null,pair=game?.order?.[game?.turn]||[],actor=pair[0]!=null?unitAt(game,pair[0],pair[1]):null,units=team=>[...(game?.teams?.[team]?.field||[]),...(game?.teams?.[team]?.bench||[]),...(game?.teams?.[team]?.summons||[])].filter(Boolean),sum=(list,key)=>list.reduce((n,u)=>n+Number(u?.[key]||0),0),energy=list=>list.reduce((n,u)=>n+[...(u?.energy||[]),...(u?.beastEnergy||[]),...(u?.riderEnergy||[])].reduce((m,e)=>m+Number(e?.a||0),0),0),p=units('P'),a=units('A');return{role:runtime?.role||null,matchId:game?.matchId||runtime?.matchId||null,battleId:game?.battleId||null,revision:Number(game?.networkRevision||0),turnSerial:Number(game?.turnSerial||0),turn:Number(game?.turn||0),actorTeam:pair[0]??null,actorSlot:pair[1]??null,actorUid:actor?.uid||game?.activeEntityId||null,actorCard:actor?.card||null,phase:game?.phase||null,winner:game?.winner||null,eventSequence:Number(game?.eventSequence||0),P:{hp:sum(p,'hp'),energy:energy(p)},A:{hp:sum(a,'hp'),energy:energy(a)},pendingTransaction:game?.pendingTransaction?.actionId||null,admission:window.OnlineActionAdmissionOwner?.debug?.()||null,recoveredErrors:(window.__megaRecoveredErrors||[]).slice(-10),locks:window.InputLockManager?.snapshot?.()||[],audit:window.TransactionAuditChannel?.snapshot?.()||[]};});}
export async function waitCanonicalActionCommit({host,guest,beforeHost,beforeGuest,timeout=60000}){
  expect(beforeGuest.matchId).toBe(beforeHost.matchId);expect(beforeGuest.turnSerial).toBe(beforeHost.turnSerial);expect(beforeGuest.revision).toBe(beforeHost.revision);
  let last=null;
  try{
    await expect.poll(async()=>{
      const [h,g]=await Promise.all([canonicalBattleState(host),canonicalBattleState(guest)]);last={h,g};
      const admissionFailure=h.recoveredErrors.find(row=>row.site==='online-action-admission.receive');
      if(admissionFailure)throw new Error(`HOST_ACTION_ADMISSION_EXCEPTION:${admissionFailure.name}:${admissionFailure.message}`);
      const converged=h.matchId===g.matchId&&h.turnSerial===g.turnSerial&&h.revision===g.revision&&h.actorTeam===g.actorTeam&&h.actorSlot===g.actorSlot&&h.P.hp===g.P.hp&&h.A.hp===g.A.hp&&h.P.energy===g.P.energy&&h.A.energy===g.A.energy;
      const changed=h.turnSerial!==beforeHost.turnSerial||h.eventSequence!==beforeHost.eventSequence||h.P.hp!==beforeHost.P.hp||h.A.hp!==beforeHost.A.hp||h.P.energy!==beforeHost.P.energy||h.A.energy!==beforeHost.A.energy;
      const hostCommit=h.audit.filter(row=>row.type==='ACTION_TRANSACTION_COMMITTED'&&Number(row.turnSerialBefore)===beforeHost.turnSerial);
      return converged&&changed&&h.revision===beforeHost.revision+1&&!h.pendingTransaction&&!g.pendingTransaction&&!h.admission?.pending&&!g.admission?.pending&&hostCommit.length===1;
    },{timeout}).toBe(true);
  }catch(error){throw new Error(`canonical action must commit exactly once and converge; last=${JSON.stringify(last)}; cause=${String(error)}`);}
  const afterHost=await canonicalBattleState(host),afterGuest=await canonicalBattleState(guest);
  const commit=afterHost.audit.filter(row=>row.type==='ACTION_TRANSACTION_COMMITTED'&&Number(row.turnSerialBefore)===beforeHost.turnSerial).at(-1);
  const begin=afterHost.audit.find(row=>row.type==='ACTION_TRANSACTION_BEGAN'&&row.actionId===commit?.actionId);
  expect(begin?.action,'clicked canonical action object').toBeTruthy();expect(commit?.actionId,'generated canonical action ID').toBeTruthy();expect(afterHost.locks,'host input locks released after commit').toEqual([]);expect(afterGuest.locks,'guest input locks released after projection').toEqual([]);
  return{beforeHost,beforeGuest,afterHost,afterGuest,begin,commit};
}
export async function touchCanonicalAction({host,guest,actor,label=/에너지\s*모으기/,timeout=60000}){const beforeHost=await canonicalBattleState(host),beforeGuest=await canonicalBattleState(guest);const buttons=actor.locator('#actionButtons button:not([disabled]):visible, #actionButtons .skillbtn:not([disabled]):visible');const count=await buttons.count();let chosen=null,clickedLabel='';for(let i=0;i<count;i++){const text=((await buttons.nth(i).textContent())||'').replace(/\s+/g,' ').trim();if(label.test(text)){chosen=buttons.nth(i);clickedLabel=text;break}}if(!chosen)throw new Error(`CANONICAL_ACTION_BUTTON_NOT_FOUND:${label}`);await chosen.tap();await resolveInteraction(actor);return{clickedLabel,...await waitCanonicalActionCommit({host,guest,beforeHost,beforeGuest,timeout})};}
export async function runtimeSummary(page){return await page.evaluate(()=>({runtime:window.OnlineRuntime?.debug?.()||null,diagnostic:window.DiagnosticTraceOwner?.currentStateSummary?.()||null,dom:window.DiagnosticTraceOwner?.domSurfaceSummary?.()||null,room:document.getElementById('roomReadyState')?.textContent||null,actions:document.querySelectorAll('#actionButtons button:not([disabled])').length}));}
export async function actualPlayerPath(host,guest){const roomCode=await pairByRoomCode(host,guest);await selectFour(host);await waitRemoteCount(guest,4);await selectFour(guest);await waitRemoteCount(host,4);await startBattle(host,guest);const h=await runtimeSummary(host),g=await runtimeSummary(guest);const actorPage=h.actions>0?host:g.actions>0?guest:null;if(!actorPage)throw new Error('FIRST_ACTION_READINESS_MISSING');await touchFirstLegalAction(actorPage);return {roomCode,host:await runtimeSummary(host),guest:await runtimeSummary(guest)};}

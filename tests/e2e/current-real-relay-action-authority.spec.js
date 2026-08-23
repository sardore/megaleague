import { test, expect, chromium } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pairByRoomCode, selectFour, waitRemoteCount, startBattle, canonicalBattleState, touchCanonicalAction, waitCanonicalActionCommit } from '../helpers/player-path.js';

const APP=process.env.CP32_CURRENT_APP_URL||'http://127.0.0.1:4173/?relay=ws%3A%2F%2F127.0.0.1%3A8787%2Fonline';
const OUT=process.env.CP32_REAL_RELAY_ARTIFACTS||'artifacts/real-relay';
const LEGAL='#actionButtons button:not([disabled]):visible, #actionButtons .skillbtn:not([disabled]):visible';

function write(name,value){fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,name),JSON.stringify(value,null,2));}
async function launch(name){const dir=fs.mkdtempSync(path.join(os.tmpdir(),`cp32-authority-${name}-`));const context=await chromium.launchPersistentContext(dir,{headless:true,viewport:{width:412,height:915},deviceScaleFactor:2.625,hasTouch:true,isMobile:true,userAgent:'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36'});const page=context.pages()[0]||await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(String(error)));page.on('console',message=>{if(message.type()==='error')errors.push(`console:${message.text()}`)});return{name,context,page,errors,async close(){await context.close();}};}
async function waitReady(page){await expect.poll(async()=>{const d=await page.evaluate(()=>window.OnlineRuntime?.debug?.()||null);return d?.state==='IN_BATTLE'&&d?.committed===true&&d?.transport?.ready===true&&!d?.transport?.candidateBindingId;},{timeout:60000}).toBe(true);}
async function actorClient(host,guest){await expect.poll(async()=>Number((await host.page.locator(LEGAL).count())>0)+Number((await guest.page.locator(LEGAL).count())>0),{timeout:60000,message:'exactly one client must own the canonical action panel'}).toBe(1);return(await host.page.locator(LEGAL).count())>0?host:guest;}
async function selectDeck(page,preferred){
  for(const id of preferred){
    const card=page.locator(`#onlineRoomDeck .online-room-card[data-card-id="${id}"]`);
    await expect(card,`preferred card ${id}`).toHaveCount(1);
    await expect(card).toHaveAttribute('aria-disabled','false');
    await card.tap();
  }
  while(await page.locator('#onlineRoomDeck .online-room-card.selected').count()<4){
    const card=page.locator('#onlineRoomDeck .online-room-card:not(.selected):not(.league-slot-blocked)[aria-disabled="false"]').first();
    await expect(card).toBeVisible();await card.tap();
  }
  await expect(page.locator('#onlineRoomDeck .online-room-card.selected')).toHaveCount(4);
}
async function expectUnchangedBattle(before,page){
  const after=await canonicalBattleState(page);
  expect({matchId:after.matchId,revision:after.revision,turnSerial:after.turnSerial,actorUid:after.actorUid,P:after.P,A:after.A})
    .toEqual({matchId:before.matchId,revision:before.revision,turnSerial:before.turnSerial,actorUid:before.actorUid,P:before.P,A:before.A});
  const runtime=await page.evaluate(()=>window.OnlineRuntime?.debug?.()||null);
  expect(runtime?.state).toBe('IN_BATTLE');expect(runtime?.committed).toBe(true);
}

test('first host and guest gather use one admission, transaction, revision and projection path',async()=>{
  test.setTimeout(240000);
  const host=await launch('host'),guest=await launch('guest');
  const evidence={ok:false,steps:[]};
  try{
    await Promise.all([host.page.goto(APP,{waitUntil:'domcontentloaded'}),guest.page.goto(APP,{waitUntil:'domcontentloaded'})]);
    evidence.roomCode=await pairByRoomCode(host.page,guest.page);
    await selectFour(host.page);await waitRemoteCount(guest.page,4);
    await selectFour(guest.page);await waitRemoteCount(host.page,4);
    await startBattle(host.page,guest.page);await Promise.all([waitReady(host.page),waitReady(guest.page)]);
    await Promise.all([host.page.evaluate(()=>window.TransactionAuditChannel?.clear?.()),guest.page.evaluate(()=>window.TransactionAuditChannel?.clear?.())]);

    for(let index=0;index<2;index++){
      const actor=await actorClient(host,guest),actorState=await canonicalBattleState(actor.page);
      const step=await touchCanonicalAction({host:host.page,guest:guest.page,actor:actor.page,label:/에너지\s*모으기/});
      expect(step.beforeHost.turnSerial).toBe(index);
      expect(step.afterHost.turnSerial).toBe(index+1);
      expect(step.afterGuest.turnSerial).toBe(index+1);
      expect(step.commit.actionType).toBe('gather');
      expect(step.begin.action.type).toBe('gather');
      expect(step.afterHost.audit.filter(row=>row.type==='ACTION_TRANSACTION_COMMITTED'&&row.actionId===step.commit.actionId)).toHaveLength(1);
      evidence.steps.push({index,actor:actor.name,role:actorState.role,clickedLabel:step.clickedLabel,actionId:step.commit.actionId,before:{turnSerial:step.beforeHost.turnSerial,revision:step.beforeHost.revision,actorTeam:step.beforeHost.actorTeam,P:step.beforeHost.P,A:step.beforeHost.A},after:{turnSerial:step.afterHost.turnSerial,revision:step.afterHost.revision,actorTeam:step.afterHost.actorTeam,P:step.afterHost.P,A:step.afterHost.A},begin:step.begin,commit:step.commit,guestAdmission:step.afterGuest.admission});
    }

    expect(new Set(evidence.steps.map(step=>step.role))).toEqual(new Set(['host','guest']));
    const guestStep=evidence.steps.find(step=>step.role==='guest');
    expect(guestStep.guestAdmission.resolutionTrace.some(row=>row.actionId===guestStep.actionId&&row.resolution==='authority:accepted'),'guest command must settle from the host authoritative envelope').toBe(true);
    const [finalHost,finalGuest]=await Promise.all([canonicalBattleState(host.page),canonicalBattleState(guest.page)]);
    expect(finalGuest).toEqual(expect.objectContaining({matchId:finalHost.matchId,revision:finalHost.revision,turnSerial:finalHost.turnSerial,actorTeam:finalHost.actorTeam,actorSlot:finalHost.actorSlot,P:finalHost.P,A:finalHost.A}));
    expect(host.errors).toEqual([]);expect(guest.errors).toEqual([]);
    evidence.ok=true;evidence.final={host:finalHost,guest:finalGuest};write('action-authority-first-gathers.json',evidence);
  }catch(error){evidence.error=String(error);evidence.host=await canonicalBattleState(host.page).catch(()=>null);evidence.guest=await canonicalBattleState(guest.page).catch(()=>null);evidence.hostErrors=host.errors;evidence.guestErrors=guest.errors;write('action-authority-first-gathers.json',evidence);throw error;}
  finally{await Promise.allSettled([host.close(),guest.close()]);}
});

test('switch, target/payment modal, damaging skill and Timeora overflow each commit once through the same authority path',async()=>{
  test.setTimeout(360000);
  const host=await launch('surfaces-host'),guest=await launch('surfaces-guest');
  const evidence={ok:false,actions:[],modal:null};
  try{
    await Promise.all([host.page.goto(APP,{waitUntil:'domcontentloaded'}),guest.page.goto(APP,{waitUntil:'domcontentloaded'})]);
    evidence.roomCode=await pairByRoomCode(host.page,guest.page);
    await selectDeck(host.page,['dragonfish','timeora']);await waitRemoteCount(guest.page,4);
    await selectDeck(guest.page,['dragonfish','timeora']);await waitRemoteCount(host.page,4);
    await startBattle(host.page,guest.page);await Promise.all([waitReady(host.page),waitReady(guest.page)]);
    await Promise.all([host.page.evaluate(()=>window.TransactionAuditChannel?.clear?.()),guest.page.evaluate(()=>window.TransactionAuditChannel?.clear?.())]);

    for(let serial=0;serial<4;serial++){
      const actor=await actorClient(host,guest),before=await canonicalBattleState(actor.page);
      expect(before.actorCard).toBe(serial<2?'dragonfish':'timeora');
      const step=await touchCanonicalAction({host:host.page,guest:guest.page,actor:actor.page,label:/에너지\s*모으기/});
      evidence.actions.push({serial,kind:'gather',actor:actor.name,actionId:step.commit.actionId});
    }

    const switchActor=await actorClient(host,guest),switchBefore=await canonicalBattleState(switchActor.page);
    expect(switchBefore.turnSerial).toBe(4);expect(switchBefore.actorCard).toBe('dragonfish');
    const switchStep=await touchCanonicalAction({host:host.page,guest:guest.page,actor:switchActor.page,label:/와\s*교체/});
    expect(switchStep.commit.actionType).toBe('switch');
    evidence.actions.push({serial:4,kind:'switch',actor:switchActor.name,actionId:switchStep.commit.actionId});

    const skillActor=await actorClient(host,guest),skillBefore=await canonicalBattleState(skillActor.page);
    expect(skillBefore.turnSerial).toBe(5);expect(skillBefore.actorCard).toBe('dragonfish');
    const skillButton=skillActor.page.locator(LEGAL).filter({hasText:'심해의토네이도'}).first();
    await expect(skillButton).toBeVisible();await skillButton.tap();
    const target=skillActor.page.locator('.battle-unit-card.targetable:visible').first();await expect(target).toBeVisible();await target.tap();
    await expect(skillActor.page.locator('#modal.open #manualPaymentConfirm')).toBeVisible();
    evidence.modal={before:skillBefore,content:await skillActor.page.locator('#modalContent').innerText()};
    await skillActor.page.locator('#closeModal').tap();await expect(skillActor.page.locator('#modal')).not.toHaveClass(/open/);
    await expectUnchangedBattle(skillBefore,skillActor.page);
    const skillStep=await touchCanonicalAction({host:host.page,guest:guest.page,actor:skillActor.page,label:/심해의토네이도/});
    expect(skillStep.commit.actionType).toBe('skill');
    expect(skillStep.afterHost.P.hp+skillStep.afterHost.A.hp).toBeLessThan(skillStep.beforeHost.P.hp+skillStep.beforeHost.A.hp);
    evidence.actions.push({serial:5,kind:'skill',actor:skillActor.name,actionId:skillStep.commit.actionId,hpBefore:skillStep.beforeHost.P.hp+skillStep.beforeHost.A.hp,hpAfter:skillStep.afterHost.P.hp+skillStep.afterHost.A.hp});

    for(let serial=6;serial<10;serial++){
      const actor=await actorClient(host,guest),before=await canonicalBattleState(actor.page);
      if(serial<8)expect(before.actorCard).toBe('timeora');
      const step=await touchCanonicalAction({host:host.page,guest:guest.page,actor:actor.page,label:/에너지\s*모으기/});
      evidence.actions.push({serial,kind:'gather',actor:actor.name,actorCard:before.actorCard,actionId:step.commit.actionId});
    }

    const overflowActor=await actorClient(host,guest),overflowBeforeHost=await canonicalBattleState(host.page),overflowBeforeGuest=await canonicalBattleState(guest.page);
    const overflowActorState=overflowActor===host?overflowBeforeHost:overflowBeforeGuest;
    expect(overflowActorState.turnSerial).toBe(10);expect(overflowActorState.actorCard).toBe('timeora');
    const gather=overflowActor.page.locator(LEGAL).filter({hasText:/에너지\s*모으기/}).first();await expect(gather).toBeVisible();await gather.tap();
    await expect(overflowActor.page.locator('#timeGatherKeep')).toBeVisible();await overflowActor.page.locator('#timeGatherKeep').tap();
    await expect(overflowActor.page.locator('#timeDiscardNew')).toBeVisible();
    evidence.overflowPrompt=await overflowActor.page.locator('#modalContent').innerText();
    await overflowActor.page.locator('#timeDiscardNew').tap();
    const overflowStep=await waitCanonicalActionCommit({host:host.page,guest:guest.page,beforeHost:overflowBeforeHost,beforeGuest:overflowBeforeGuest});
    expect(overflowStep.commit.actionType).toBe('gather');expect(overflowStep.begin.action.timeDeclineOverflow).toBe(true);
    evidence.actions.push({serial:10,kind:'overflow-gather',actor:overflowActor.name,actionId:overflowStep.commit.actionId,action:overflowStep.begin.action});

    expect(host.errors).toEqual([]);expect(guest.errors).toEqual([]);evidence.ok=true;
    evidence.final={host:await canonicalBattleState(host.page),guest:await canonicalBattleState(guest.page)};
    write('action-authority-surfaces.json',evidence);
  }catch(error){evidence.error=String(error);evidence.host=await canonicalBattleState(host.page).catch(()=>null);evidence.guest=await canonicalBattleState(guest.page).catch(()=>null);evidence.hostErrors=host.errors;evidence.guestErrors=guest.errors;write('action-authority-surfaces.json',evidence);throw error;}
  finally{await Promise.allSettled([host.close(),guest.close()]);}
});

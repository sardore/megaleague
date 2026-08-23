import { test, expect, chromium } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pairByRoomCode, selectFour, waitRemoteCount, startBattle, canonicalBattleState, touchCanonicalAction } from '../helpers/player-path.js';

const APP=process.env.CP32_CURRENT_APP_URL||'http://127.0.0.1:4173/?relay=ws%3A%2F%2F127.0.0.1%3A8787%2Fonline';
const OUT=process.env.CP32_REAL_RELAY_ARTIFACTS||'artifacts/real-relay';
const LEGAL='#actionButtons button:not([disabled]):visible, #actionButtons .skillbtn:not([disabled]):visible';

function write(name,value){fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,name),JSON.stringify(value,null,2));}
async function launch(name){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),`cp32-revision-${name}-`));
  const context=await chromium.launchPersistentContext(dir,{headless:true,viewport:{width:412,height:915},deviceScaleFactor:2.625,hasTouch:true,isMobile:true,userAgent:'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36'});
  const page=context.pages()[0]||await context.newPage();
  return{name,context,page,async close(){await context.close();}};
}
async function waitReady(page){
  await expect.poll(async()=>{const d=await page.evaluate(()=>window.OnlineRuntime?.debug?.()||null);return d?.state==='IN_BATTLE'&&d?.committed===true&&d?.transport?.ready===true&&!d?.transport?.candidateBindingId;},{timeout:60000}).toBe(true);
}
async function actorClient(host,guest){
  await expect.poll(async()=>Number((await host.page.locator(LEGAL).count())>0)+Number((await guest.page.locator(LEGAL).count())>0),{timeout:60000}).toBe(1);
  return (await host.page.locator(LEGAL).count())>0?host:guest;
}
async function converge(host,guest,revision,turnSerial){
  await expect.poll(async()=>{
    const [h,g]=await Promise.all([canonicalBattleState(host.page),canonicalBattleState(guest.page)]);
    return h.revision===revision&&g.revision===revision&&h.turnSerial===turnSerial&&g.turnSerial===turnSerial;
  },{timeout:30000}).toBe(true);
}

test('unchanged authoritative resends reuse the committed revision',async()=>{
  test.setTimeout(240000);
  const host=await launch('host'),guest=await launch('guest');
  const evidence={ok:false,steps:[]};
  try{
    await Promise.all([host.page.goto(APP,{waitUntil:'domcontentloaded'}),guest.page.goto(APP,{waitUntil:'domcontentloaded'})]);
    evidence.roomCode=await pairByRoomCode(host.page,guest.page);
    await selectFour(host.page);await waitRemoteCount(guest.page,4);
    await selectFour(guest.page);await waitRemoteCount(host.page,4);
    await startBattle(host.page,guest.page);await Promise.all([waitReady(host.page),waitReady(guest.page)]);

    const actor=await actorClient(host,guest);
    const commit=await touchCanonicalAction({host:host.page,guest:guest.page,actor:actor.page,label:/에너지\s*모으기/});
    const committed=await canonicalBattleState(host.page);
    expect(committed.turnSerial).toBe(1);
    expect(committed.revision).toBe(1);
    evidence.steps.push({kind:'canonical-action',actor:actor.name,revision:committed.revision,turnSerial:committed.turnSerial,actionId:commit.commit.actionId});

    const publication=await host.page.evaluate(()=>({
      before:{revision:Number(game?.networkRevision||0),turnSerial:Number(game?.turnSerial||0)},
      sent:typeof broadcastOnlineState==='function'?broadcastOnlineState([]):null,
      after:{revision:Number(game?.networkRevision||0),turnSerial:Number(game?.turnSerial||0)},
    }));
    evidence.steps.push({kind:'unchanged-normal-publication',...publication});
    expect(publication.sent).not.toBe(null);
    expect(publication.after).toEqual(publication.before);
    await converge(host,guest,committed.revision,committed.turnSerial);

    const forced=await host.page.evaluate(()=>({
      before:{revision:Number(game?.networkRevision||0),turnSerial:Number(game?.turnSerial||0)},
      sent:typeof sendAuthoritativeOnlineState==='function'?sendAuthoritativeOnlineState([],null,true):null,
      after:{revision:Number(game?.networkRevision||0),turnSerial:Number(game?.turnSerial||0)},
    }));
    evidence.steps.push({kind:'unchanged-forced-publication',...forced});
    expect(forced.sent).not.toBe(null);
    expect(forced.after).toEqual(forced.before);
    await converge(host,guest,committed.revision,committed.turnSerial);

    const nextActor=await actorClient(host,guest);
    const second=await touchCanonicalAction({host:host.page,guest:guest.page,actor:nextActor.page,label:/에너지\s*모으기/});
    const final=await canonicalBattleState(host.page);
    expect(final.turnSerial).toBe(committed.turnSerial+1);
    expect(final.revision).toBe(committed.revision+1);
    evidence.steps.push({kind:'second-canonical-action',actor:nextActor.name,revision:final.revision,turnSerial:final.turnSerial,actionId:second.commit.actionId});
    evidence.ok=true;evidence.final={host:final,guest:await canonicalBattleState(guest.page)};
    write('revision-idempotency.json',evidence);
  }catch(error){
    evidence.error=String(error);evidence.host=await canonicalBattleState(host.page).catch(()=>null);evidence.guest=await canonicalBattleState(guest.page).catch(()=>null);write('revision-idempotency.json',evidence);throw error;
  }finally{await Promise.allSettled([host.close(),guest.close()]);}
});

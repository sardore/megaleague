import { test, expect, chromium } from '@playwright/test';
import { pairByRoomCode, waitRemoteCount, startBattle, canonicalBattleState, touchCanonicalAction } from '../helpers/player-path.js';
const APP=process.env.CP32_CURRENT_APP_URL||'http://127.0.0.1:4173/?relay=ws%3A%2F%2F127.0.0.1%3A8787%2Fonline';
test('Weller curse visuals reach both mobile peers exactly once',async()=>{
  const browser=await chromium.launch();
  const host=await browser.newPage({viewport:{width:412,height:915},hasTouch:true,isMobile:true});
  const guest=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  const errors=[];for(const p of [host,guest])p.on('pageerror',e=>errors.push(String(e)));
  try{
    await Promise.all([host.goto(APP),guest.goto(APP)]);await pairByRoomCode(host,guest);
    for(const page of [host,guest])for(const id of ['weller','hermit','turtle','mushroom']){
      const card=page.locator(`#onlineRoomDeck .online-room-card[data-card-id="${id}"]`);
      await card.scrollIntoViewIfNeeded();await card.tap({position:{x:30,y:25}});
    }
    await Promise.all([waitRemoteCount(host,4),waitRemoteCount(guest,4)]);await startBattle(host,guest);
    for(const page of [host,guest])await page.evaluate(()=>{
      window.wellerVisuals=[];
      new MutationObserver(records=>{for(const r of records)for(const n of r.addedNodes)if(n.classList?.contains('weller-fx')&&n.dataset.wellerPhase==='curse'){
        const p=n.querySelector('.weller-ritual').getBoundingClientRect();window.wellerVisuals.push({x:p.x,y:p.y,width:p.width,height:p.height});
      }}).observe(document.body,{childList:true,subtree:true});
    });
    let cast=false;
    for(let step=0;step<36&&!cast;step++){
      await expect.poll(async()=>{const h=await canonicalBattleState(host),g=await canonicalBattleState(guest);return h.revision===g.revision&&h.turnSerial===g.turnSerial&&!h.locks.length&&!g.locks.length;}).toBe(true);
      const state=await canonicalBattleState(host),actor=state.actorTeam==='P'?host:guest;
      const curse=actor.locator('#actionButtons button:not([disabled])').filter({hasText:'억누른저주'});
      if(await curse.count()){
        await touchCanonicalAction({host,guest,actor,label:/억누른저주/});cast=true;
      }else await touchCanonicalAction({host,guest,actor,label:/에너지\s*모으기/});
    }
    expect(cast).toBe(true);
    for(const page of [host,guest]){
      await expect.poll(()=>page.evaluate(()=>window.wellerVisuals.length)).toBe(1);
      const [point]=await page.evaluate(()=>window.wellerVisuals);expect(point.width).toBeGreaterThan(0);expect(point.x).toBeGreaterThanOrEqual(-20);expect(point.y).toBeGreaterThanOrEqual(0);
    }
    expect(errors).toEqual([]);
  }finally{await browser.close();}
});
